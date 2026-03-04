// src/modules/accounting/actions/account.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateAccountSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  code: z.string().min(1, "El codigo es requerido").max(20),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo de cuenta invalido",
  }),
  description: z.string().max(255).optional(),
});

const UpdateAccountSchema = CreateAccountSchema.partial().extend({
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

export async function getAccountsAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof prisma.account.findMany>>>
> {
  try {
    const accounts = await prisma.account.findMany({
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

    // Verificar que el codigo no exista
    const existing = await prisma.account.findUnique({
      where: { code: validated.code },
    });

    if (existing) {
      return {
        success: false,
        error: `El codigo ${validated.code} ya esta en uso por la cuenta "${existing.name}"`,
      };
    }

    const existingName = await prisma.account.findUnique({
      where: { name: validated.name },
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

    const account = await prisma.account.create({ data: validated });

    revalidatePath("/accounting/accounts");

    // Retornar warning si el codigo esta fuera del rango estandar
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

    if (data.code) {
      const existing = await prisma.account.findFirst({
        where: { code: data.code, NOT: { id } },
      });
      if (existing) {
        return {
          success: false,
          error: `El codigo ${data.code} ya esta en uso por la cuenta "${existing.name}"`,
        };
      }
    }

    const account = await prisma.account.update({ where: { id }, data });

    revalidatePath("/accounting/accounts");

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
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"
): Promise<ActionResult<{ code: string }>> {
  try {
    const range = RANGES[type];

    const accounts = await prisma.account.findMany({
      select: { code: true },
    });

    // Filtrar y ordenar numericamente de forma ascendente
    const codesInRange = accounts
      .map((a) => Number(a.code))
      .filter((code) => !isNaN(code) && code >= range.start && code <= range.end)
      .sort((a, b) => a - b);

    // Buscar primer hueco disponible desde el inicio del rango
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
