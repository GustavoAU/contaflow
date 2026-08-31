// src/modules/accounting/actions/account.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { withCompanyContext } from "@/lib/prisma-rls";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateAccountSchema = z.object({
  companyId: z.string().min(1, "Company ID es requerido"),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  code: z
    .string()
    .min(1, "El codigo es requerido")
    .max(20)
    .regex(/^\d+([.\-]\d+)*$/, "El codigo debe ser numérico o jerárquico (ej: 1105, 1-1-05, 1.1.05)"),
  type: z.enum(["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"], {
    error: "Tipo de cuenta invalido",
  }),
  description: z.string().max(255).optional(),
  // VEN-NIF 3: true = Caja/Bancos/CxC/CxP — excluida de reexpresión INPC
  isMonetary: z.boolean().default(false),
  // VEN-NIF BA-10 / IAS 1: true = corriente (ASSET/CONTRA_ASSET/LIABILITY ≤12 meses)
  isCurrent: z.boolean().default(false),
});

const UpdateAccountSchema = CreateAccountSchema.omit({ companyId: true })
  .partial()
  .extend({
    id: z.string().min(1, "ID es requerido"),
  });

// ─── Rangos por tipo ──────────────────────────────────────────────────────────

// Clasificación de códigos de cuenta según el Plan de Cuentas VEN-NIF.
// Fuente: DPC-0 (Declaración de Principios de Contabilidad) + VEN-NIF Marco Conceptual §4.4.
//   1xxx → Activo (ASSET y CONTRA_ASSET comparten el rango; ej: 1105 Bancos, 1199 Dep. Acum.)
//   2xxx → Pasivo
//   3xxx → Patrimonio
//   4xxx → Ingreso
//   5xxx → Gasto
// Los códigos fuera de rango son válidos (el sistema crea la cuenta con advertencia).
import { nextAccountCode } from "../utils/next-account-code";

const RANGES: Record<string, { start: number; end: number }> = {
  ASSET: { start: 1000, end: 1999 },
  CONTRA_ASSET: { start: 1000, end: 1999 },
  LIABILITY: { start: 2000, end: 2999 },
  EQUITY: { start: 3000, end: 3999 },
  REVENUE: { start: 4000, end: 4999 },
  EXPENSE: { start: 5000, end: 5999 },
};

// ─── Obtener todas las cuentas ────────────────────────────────────────────────

export async function getAccountsAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof prisma.account.findMany>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.read });
    if (!ctx.ok) return ctx.error;
    const accounts = await prisma.account.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: "asc" },
    });
    return { success: true, data: accounts };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Crear cuenta ─────────────────────────────────────────────────────────────

export async function createAccountAction(
  input: z.infer<typeof CreateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

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

    const account = await prisma.$transaction(async (tx) =>
      withCompanyContext(validated.companyId, tx, async (tx) => {
        const created = await tx.account.create({
          data: {
            name: validated.name,
            code: validated.code,
            type: validated.type,
            description: validated.description,
            isMonetary: validated.isMonetary,
            isCurrent: validated.isCurrent,
            companyId: validated.companyId,
          },
        });

        await tx.auditLog.create({
          data: {
            companyId: validated.companyId,
            entityId: created.id,
            entityName: "Account",
            action: "CREATE",
            userId,
            ipAddress,
            userAgent,
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
    return toActionError(error);
  }
}

// ─── Editar cuenta ────────────────────────────────────────────────────────────

export async function updateAccountAction(
  input: z.infer<typeof UpdateAccountSchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const validated = UpdateAccountSchema.parse(input);
    const { id, ...data } = validated;

    const before = await prisma.account.findUnique({
      where: { id },
      select: { code: true, name: true, type: true, companyId: true },
    });
    if (!before) return { success: false, error: "Cuenta no encontrada" };

    const ctx = await requireCompanyAction(before.companyId, {
      roles: ROLES.ACCOUNTING,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

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
            companyId: before.companyId,
            entityId: id,
            entityName: "Account",
            action: "UPDATE",
            userId,
            ipAddress,
            userAgent,
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
    return toActionError(error);
  }
}

// ─── Generar codigo automatico ────────────────────────────────────────────────

export async function getNextAccountCodeAction(
  type: "ASSET" | "CONTRA_ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
  companyId: string
): Promise<ActionResult<{ code: string }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY", limiter: limiters.read });
    if (!ctx.ok) return ctx.error;
    const range = RANGES[type];

    const accounts = await prisma.account.findMany({
      where: { companyId, deletedAt: null },
      select: { code: true },
    });

    // La regla vive en utils/next-account-code.ts, pura y testeada. Antes se
    // arrancaba en el inicio del rango y se paraba en el primer salto, lo que en
    // un plan real —pasivos que empiezan en 2105— proponía `2000`: libre, pero
    // ninguna empresa pone ahí una cuenta de movimiento.
    const code = nextAccountCode({
      existing: accounts.map((a) => a.code),
      rangeStart: range.start,
      rangeEnd: range.end,
    });

    if (!code) {
      return { success: false, error: "Rango de codigos agotado para este tipo de cuenta" };
    }

    return { success: true, data: { code } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Eliminar cuenta ──────────────────────────────────────────────────────────
// No existía ninguna vía para quitar una cuenta del plan: sólo se podían crear y
// editar. Una cuenta creada por error —un nombre de persona en el plan, un
// código mal tecleado— se quedaba ahí para siempre, ensuciando todos los
// desplegables de cuentas de la aplicación.
//
// Borrado LÓGICO y sólo si la cuenta NO tiene movimiento. Un asiento apunta a su
// cuenta: borrarla de verdad rompería el Libro Mayor y la trazabilidad que el
// SENIAT exige. Y una cuenta con asientos no es un error que limpiar, es
// historia contable — para ésas la salida es dejar de usarlas, no borrarlas.

export async function deleteAccountAction(
  accountId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, code: true, name: true, type: true, companyId: true, deletedAt: true },
    });
    if (!account || account.deletedAt) {
      return { success: false, error: "Cuenta no encontrada" };
    }

    // El companyId sale de la cuenta, no del cliente: el guard lo verifica
    // contra la membresía real (ADR-004/ADR-041).
    const ctx = await requireCompanyAction(account.companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    // `JournalEntry` no tiene columna `companyId` propia, así que el tenant se
    // acota por la relación. `accountId` ya bastaría —una cuenta pertenece a una
    // sola empresa—, pero se deja explícito: la RLS no cubre nada (ADR-044) y un
    // filtro implícito obliga a razonar para ver que es seguro.
    const enUso = await prisma.journalEntry.count({
      where: { accountId, account: { companyId: account.companyId } },
    });
    if (enUso > 0) {
      return {
        success: false,
        error:
          `La cuenta ${account.code} tiene ${enUso} ${enUso === 1 ? "asiento" : "asientos"} ` +
          "y no puede eliminarse: borrarla rompería el Libro Mayor. Si ya no la usas, " +
          "renómbrala o deja de asignarla en las configuraciones.",
      };
    }

    await prisma.$transaction(async (tx) => {
      // El `deletedAt: null` en el where cierra la ventana entre el conteo y el
      // borrado: si otra petición la borró antes, ésta no la toca dos veces.
      const borrada = await tx.account.updateMany({
        where: { id: accountId, companyId: account.companyId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (borrada.count === 0) throw new Error("Cuenta no encontrada");

      await tx.auditLog.create({
        data: {
          companyId: account.companyId,
          entityId: accountId,
          entityName: "Account",
          action: "DELETE",
          userId,
          ipAddress,
          userAgent,
          oldValue: { code: account.code, name: account.name, type: account.type },
          newValue: Prisma.JsonNull,
        },
      });
    });

    revalidatePath(`/company/${account.companyId}/accounting/accounts`);
    return { success: true, data: { id: accountId } };
  } catch (error) {
    return toActionError(error);
  }
}
