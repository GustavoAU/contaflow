// src/modules/fiscal-close/actions/fiscal-close.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { limiters } from "@/lib/ratelimit";
import { STEP_UP_CONFIG, reverificationError, type StepUpError } from "@/lib/step-up";
import { FiscalYearCloseService } from "../services/FiscalYearCloseService";
import {
  CloseFiscalYearSchema,
  AppropriateResultSchema,
  UpdateFiscalConfigSchema,
} from "../schemas/fiscal-close.schema";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Obtener historial de cierres ──────────────────────────────────────────────
export async function getFiscalYearCloseHistoryAction(
  companyId: string
): Promise<ActionResult<Awaited<ReturnType<typeof FiscalYearCloseService.getFiscalYearCloseHistory>>>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const history = await FiscalYearCloseService.getFiscalYearCloseHistory(companyId);
    return { success: true, data: history };
  } catch (error) {
    return toActionError(error);
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
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    // Q2-3: Step-up — re-verificación con 2do factor para cierre de ejercicio
    // ADR-041 D-4: check extra/más restrictivo DESPUÉS del guard central
    const { has } = await auth();
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, ctx.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }

    const result = await FiscalYearCloseService.closeFiscalYear(
      parsed.data.companyId,
      parsed.data.year,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent
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
    return toActionError(error);
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
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    // Q2-3: Step-up — re-verificación con 2do factor para apropiación del resultado
    // ADR-041 D-4: check extra/más restrictivo DESPUÉS del guard central
    const { has } = await auth();
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, ctx.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
    }

    const result = await FiscalYearCloseService.appropriateFiscalYearResult(
      parsed.data.companyId,
      parsed.data.year,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent
    );

    revalidatePath(`/company/${parsed.data.companyId}/fiscal-close`);

    return { success: true, data: result };
  } catch (error) {
    return toActionError(error);
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
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

    // ADR-025: verifica acceso base + grants granulares al módulo Contabilidad
    if (!await hasModuleAccess(parsed.data.companyId, ctx.role, "accounting")) {
      return { success: false, error: moduleAccessError("accounting") };
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
    return toActionError(error);
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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

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
    return toActionError(error);
  }
}
