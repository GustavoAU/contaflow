// src/modules/accounting/actions/account.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateAccountSchema = z.object({
  companyId: z.string().min(1, "Company ID es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  code: z
    .string()
    .min(1, "El codigo es requerido")
    .max(20)
    .regex(/^\d+([.\-]\d+)*$/, "El codigo debe ser numérico o jerárquico (ej: 1105, 1-1-05, 1.1.05)"),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo de cuenta invalido",
  }),
  description: z.string().max(255).optional(),
});

const UpdateAccountSchema = CreateAccountSchema.omit({ companyId: true })
  .partial()
  .extend({
    id: z.string().min(1, "ID es requerido"),
  });

// ─── Rangos por tipo ──────────────────────────────────────────────────────────

const RANGES: Record<string, { start: number; end: number }> = {
  ASSET: { start: 1000, end: 1999 },
  LIABILITY: { start: 2000, end: 2999 },
  EQUITY: { start: 3000, end: 3999 },
  REVENUE: { start: 4000, end: 4999 },
  EXPENSE: { start: 5000, end: 5999 },
};

// ─── Tipo de respuesta estandar ───────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T; warning?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ─── Obtener todas las cuentas ────────────────────────────────────────────────

export async function getAccountsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof prisma.account.findMany>>>> {
  try {
    const accounts = await prisma.account.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: "asc" },
    });
    return { success: true, data: accounts };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener las cuentas" };
  }
}

// ─── Crear cuenta ─────────────────────────────────────────────────────────────

export async function createAccountAction(
  input: z.infer<typeof CreateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const validated = CreateAccountSchema.parse(input);

    // Verificar que el codigo no exista en esta empresa
    const existingCode = await prisma.account.findUnique({
      where: {
        companyId_code: {
          companyId: validated.companyId,
          code: validated.code,
        },
      },
    });

    if (existingCode) {
      return {
        success: false,
        error: `El codigo ${validated.code} ya esta en uso por la cuenta "${existingCode.name}"`,
      };
    }

    // Verificar que el nombre no exista en esta empresa
    const existingName = await prisma.account.findUnique({
      where: {
        companyId_name: {
          companyId: validated.companyId,
          name: validated.name,
        },
      },
    });

    if (existingName) {
      return {
        success: false,
        error: `Ya existe una cuenta con el nombre "${validated.name}" (codigo: ${existingName.code})`,
      };
    }

    // Verificar si el codigo esta fuera del rango de su tipo
    const codeNum = Number(validated.code);
    const range = RANGES[validated.type];
    const outOfRange = isNaN(codeNum) || codeNum < range.start || codeNum > range.end;

    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const account = await prisma.$transaction(async (tx) =>
      withCompanyContext(validated.companyId, tx, async (tx) => {
        const created = await tx.account.create({
          data: {
            name: validated.name,
            code: validated.code,
            type: validated.type,
            description: validated.description,
            companyId: validated.companyId,
          },
        });

        await tx.auditLog.create({
          data: {
            entityId: created.id,
            entityName: "Account",
            action: "CREATE",
            userId,
            newValue: { code: validated.code, name: validated.name, type: validated.type },
          },
        });

        return created;
      })
    );

    revalidatePath(`/company/${validated.companyId}/accounts`);

    if (outOfRange) {
      return {
        success: true,
        data: { id: account.id, name: account.name },
        warning: `Advertencia: El codigo ${validated.code} esta fuera del rango estandar para cuentas de tipo ${validated.type} (${range.start}-${range.end}). La cuenta fue creada de todas formas.`,
      };
    }

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos invalidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al crear la cuenta" };
  }
}

// ─── Editar cuenta ────────────────────────────────────────────────────────────

export async function updateAccountAction(
  input: z.infer<typeof UpdateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const validated = UpdateAccountSchema.parse(input);
    const { id, ...data } = validated;

    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const before = await prisma.account.findUnique({
      where: { id },
      select: { code: true, name: true, type: true, companyId: true },
    });
    if (!before) return { success: false, error: "Cuenta no encontrada" };

    if (data.code) {
      // FIX CRÍTICO-1 (ADR-004): unicidad de código scoped a companyId.
      // Sin companyId, un código existente en empresa B bloqueaba actualizaciones
      // legítimas en empresa A. Ver lessons-learned.md LL-003.
      const existing = await prisma.account.findFirst({
        where: {
          code: data.code,
          companyId: before.companyId, // ← fix: era `companyId: before.companyId` pero faltaba antes
          NOT: { id },
          deletedAt: null,
        },
      });
      if (existing) {
        return {
          success: false,
          error: `El codigo ${data.code} ya esta en uso por la cuenta "${existing.name}"`,
        };
      }
    }

    const account = await prisma.$transaction(async (tx) =>
      withCompanyContext(before.companyId, tx, async (tx) => {
        const updated = await tx.account.update({ where: { id }, data });

        await tx.auditLog.create({
          data: {
            entityId: id,
            entityName: "Account",
            action: "UPDATE",
            userId,
            oldValue: before as object,
            newValue: data as object,
          },
        });

        return updated;
      })
    );

    revalidatePath("/company");

    return { success: true, data: { id: account.id, name: account.name } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos invalidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al actualizar la cuenta" };
  }
}

// ─── Generar codigo automatico ────────────────────────────────────────────────

export async function getNextAccountCodeAction(
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
  companyId: string
): Promise<ActionResult<{ code: string }>> {
  try {
    const range = RANGES[type];

    const accounts = await prisma.account.findMany({
      where: { companyId, deletedAt: null },
      select: { code: true },
    });

    const codesInRange = accounts
      .map((a) => Number(a.code))
      .filter((code) => !isNaN(code) && code >= range.start && code <= range.end)
      .sort((a, b) => a - b);

    let nextCode = range.start;
    for (const code of codesInRange) {
      if (code === nextCode) {
        nextCode++;
      } else {
        break;
      }
    }

    if (nextCode > range.end) {
      return { success: false, error: "Rango de codigos agotado para este tipo de cuenta" };
    }

    return { success: true, data: { code: String(nextCode) } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar el codigo" };
  }
}
