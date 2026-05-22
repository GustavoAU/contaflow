// src/modules/fiscal-close/actions/fiscal-close.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { STEP_UP_CONFIG, reverificationError, type StepUpError } from "@/lib/step-up";
import { FiscalYearCloseService } from "../services/FiscalYearCloseService";
import {
  CloseFiscalYearSchema,
  AppropriateResultSchema,
  UpdateFiscalConfigSchema,
} from "../schemas/fiscal-close.schema";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Obtener historial de cierres ──────────────────────────────────────────────
export async function getFiscalYearCloseHistoryAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof FiscalYearCloseService.getFiscalYearCloseHistory>>>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Acceso denegado" };

    const history = await FiscalYearCloseService.getFiscalYearCloseHistory(companyId);
    return { success: true, data: history };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener el historial de cierres" };
  }
}

// ─── Cerrar ejercicio económico ────────────────────────────────────────────────
export async function closeFiscalYearAction(
  input: unknown
): Promise<ActionResult<{
  fiscalYearCloseId: string;
  closingTransactionId: string;
  totalRevenue: string;
  totalExpenses: string;
  netResult: string;
  closingEntriesCount: number;
}> | StepUpError> {
  const parsed = CloseFiscalYearSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { userId, has } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // Q2-3: Step-up — re-verificación con 2do factor para cierre de ejercicio
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    // Solo ADMIN puede ejecutar el cierre de ejercicio
    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, member.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo el Administrador puede cerrar el ejercicio económico." };
    }

    const result = await FiscalYearCloseService.closeFiscalYear(
      parsed.data.companyId,
      parsed.data.year,
      userId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company/${parsed.data.companyId}/fiscal-close`);
    revalidatePath(`/company/${parsed.data.companyId}/settings`);

    return {
      success: true,
      data: {
        fiscalYearCloseId: result.fiscalYearCloseId,
        closingTransactionId: result.closingTransactionId,
        totalRevenue: result.totalRevenue.toString(),
        totalExpenses: result.totalExpenses.toString(),
        netResult: result.netResult.toString(),
        closingEntriesCount: result.closingEntriesCount,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al cerrar el ejercicio" };
  }
}

// ─── Apropiación del resultado del ejercicio ───────────────────────────────────
export async function appropriateFiscalYearResultAction(
  input: unknown
): Promise<ActionResult<{ appropriationTransactionId: string }> | StepUpError> {
  const parsed = AppropriateResultSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { userId, has } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // Q2-3: Step-up — re-verificación con 2do factor para apropiación del resultado
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, member.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return {
        success: false,
        error: "Solo el Administrador puede registrar la apropiación del resultado.",
      };
    }

    const result = await FiscalYearCloseService.appropriateFiscalYearResult(
      parsed.data.companyId,
      parsed.data.year,
      userId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company/${parsed.data.companyId}/fiscal-close`);

    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al registrar la apropiación" };
  }
}

// ─── Configuración Contable — cuentas de cierre ────────────────────────────────
export async function updateFiscalConfigAction(
  input: unknown
): Promise<ActionResult<{ companyId: string }>> {
  const parsed = UpdateFiscalConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, member.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return {
        success: false,
        error: "Solo el Administrador puede modificar la configuración contable.",
      };
    }

    // Validar que las cuentas existen, pertenecen a la empresa y son EQUITY
    const accounts = await prisma.account.findMany({
      where: {
        id: { in: [parsed.data.resultAccountId, parsed.data.retainedEarningsAccountId] },
        companyId: parsed.data.companyId,
        deletedAt: null,
      },
      select: { id: true, type: true, name: true },
    });

    if (accounts.length !== 2) {
      return { success: false, error: "Una o ambas cuentas no fueron encontradas en esta empresa." };
    }

    const nonEquity = accounts.filter((a) => a.type !== "EQUITY");
    if (nonEquity.length > 0) {
      const names = nonEquity.map((a) => `"${a.name}"`).join(", ");
      return {
        success: false,
        error: `Las siguientes cuentas no son de tipo Patrimonio (EQUITY): ${names}. Solo se permiten cuentas EQUITY para el cierre.`,
      };
    }

    if (parsed.data.resultAccountId === parsed.data.retainedEarningsAccountId) {
      return {
        success: false,
        error: "La cuenta Resultado del Ejercicio y la cuenta Utilidades Retenidas no pueden ser la misma.",
      };
    }

    await prisma.$transaction(async (tx) => {
      const previous = await tx.company.findUnique({
        where: { id: parsed.data.companyId },
        select: { resultAccountId: true, retainedEarningsAccountId: true },
      });

      await tx.company.update({
        where: { id: parsed.data.companyId },
        data: {
          resultAccountId: parsed.data.resultAccountId,
          retainedEarningsAccountId: parsed.data.retainedEarningsAccountId,
        },
      });

      await tx.auditLog.create({
        data: {
          companyId: parsed.data.companyId,
          entityId: parsed.data.companyId,
          entityName: "Company",
          action: "UPDATE_FISCAL_CONFIG",
          userId,
          ipAddress,
          userAgent,
          oldValue: previous as object,
          newValue: {
            resultAccountId: parsed.data.resultAccountId,
            retainedEarningsAccountId: parsed.data.retainedEarningsAccountId,
          },
        },
      });
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true, data: { companyId: parsed.data.companyId } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado al actualizar la configuración" };
  }
}

// ─── Obtener configuración contable actual ─────────────────────────────────────
export async function getFiscalConfigAction(companyId: string): Promise<
  ActionResult<{
    resultAccountId: string | null;
    retainedEarningsAccountId: string | null;
    resultAccountName: string | null;
    retainedEarningsAccountName: string | null;
  }>
> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false, error: "Acceso denegado" };

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        resultAccountId: true,
        retainedEarningsAccountId: true,
        resultAccount: { select: { name: true } },
        retainedEarningsAccount: { select: { name: true } },
      },
    });

    if (!company) return { success: false, error: "Empresa no encontrada" };

    return {
      success: true,
      data: {
        resultAccountId: company.resultAccountId,
        retainedEarningsAccountId: company.retainedEarningsAccountId,
        resultAccountName: company.resultAccount?.name ?? null,
        retainedEarningsAccountName: company.retainedEarningsAccount?.name ?? null,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la configuración contable" };
  }
}
