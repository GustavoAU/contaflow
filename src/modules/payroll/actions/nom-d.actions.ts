// src/modules/payroll/actions/nom-d.actions.ts
// Fase NOM-D: Server Actions para prestaciones, vacaciones, utilidades, liquidación
//
// Seguridad (ADR-014 + ADR-006 extendido):
//   CRITICAL-3: tasa BCV nunca del cliente — postBenefitInterestAction NO recibe rate
//   NOM-D-01:  companyMember.findFirst verifica tenant antes de toda query // ADR-004-EXCEPTION: IDOR guard — where:{userId,companyId} en resolveAuth()
//   NOM-D-02:  checkRateLimit(limiters.fiscal) en toda acción write
//   NOM-D-03:  write = ADMIN_ONLY; read = ACCOUNTING
//   NOM-D-04:  P2002 → mensaje amigable (doble-accrual, doble-pago)
//   Patrón: auth → role → rateLimit → parse → service

"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import Decimal from "decimal.js";
import { BenefitAccrualService, type BenefitBalanceRow, type BcvRateRow } from "../services/BenefitAccrualService";
import { BenefitAdvanceService, type BenefitAdvanceRow } from "../services/BenefitAdvanceService";
import { VacationService, type VacationRecordRow } from "../services/VacationService";
import { ProfitSharingService, type ProfitSharingRecordRow } from "../services/ProfitSharingService";
import { TerminationService, type TerminationRow } from "../services/TerminationService";
import {
  CreateBcvRateSchema,
  AccrueQuarterSchema,
  PostBenefitInterestSchema,
  CreateVacationSchema,
  CalculateProfitSharingSchema,
  CreateTerminationSchema,
  UpdateTerminationSchema,
  RegisterBenefitAdvanceSchema,
} from "../schemas/nom-d.schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function revalidateNomD(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/benefits`);
  revalidatePath(`/company/${companyId}/payroll/terminations`);
  // U-04: actualiza la ficha del empleado (tabs prestaciones/vacaciones)
  revalidatePath(`/company/${companyId}/payroll/employees`, "layout");
}


// ─── BCV Rate ─────────────────────────────────────────────────────────────────

export async function createBcvRateAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<BcvRateRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = CreateBcvRateSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await BenefitAccrualService.createBcvRate(
      companyId,
      userId,
      parsed.data.year,
      parsed.data.month,
      parsed.data.annualRate,
      parsed.data.rateType,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: `Ya existe una tasa BCV registrada para ${parsed.data.year}-${String(parsed.data.month).padStart(2, "0")}`,
      };
    }
    return toActionError(err);
  }
}

export async function listBcvRatesAction(
  companyId: string
): Promise<ActionResult<BcvRateRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await BenefitAccrualService.listBcvRates(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Prestaciones: Acumulación Trimestral ─────────────────────────────────────

export async function accrueQuarterAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<{ employeesProcessed: number; totalAccrued: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = AccrueQuarterSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await BenefitAccrualService.accrueQuarter(
      companyId,
      userId,
      parsed.data.year,
      parsed.data.quarter,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Prestaciones: Intereses BCV ─────────────────────────────────────────────
// CRÍTICO: NO recibe rate — siempre de BcvBenefitRate tabla (ADR-014 Dec. 2 / CRITICAL-3)

export async function postBenefitInterestAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<{ employeesProcessed: number; totalInterest: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = PostBenefitInterestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await BenefitAccrualService.postBenefitInterest(
      companyId,
      userId,
      parsed.data.year,
      parsed.data.month,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Prestaciones: Saldo del empleado ────────────────────────────────────────

export async function getBenefitBalanceAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<BenefitBalanceRow | null>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await BenefitAccrualService.getBalance(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Vacaciones ───────────────────────────────────────────────────────────────

export async function createVacationAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<VacationRecordRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = CreateVacationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await VacationService.create(companyId, userId, employeeId, parsed.data, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: `Ya existe un registro de vacaciones para el período ${parsed.data.periodYear} de este empleado`,
      };
    }
    return toActionError(err);
  }
}

export async function listVacationsAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<VacationRecordRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await VacationService.listByEmployee(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

export async function calculateProfitSharingAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<ProfitSharingRecordRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = CalculateProfitSharingSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await ProfitSharingService.calculate(
      companyId,
      userId,
      employeeId,
      parsed.data,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: `Ya existe un registro de utilidades para el año fiscal ${parsed.data.fiscalYear} de este empleado`,
      };
    }
    return toActionError(err);
  }
}

export async function listProfitSharingAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<ProfitSharingRecordRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await ProfitSharingService.listByEmployee(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Liquidación Final ────────────────────────────────────────────────────────

export async function createTerminationAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<ActionResult<TerminationRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = CreateTerminationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await TerminationService.create(
      companyId,
      userId,
      employeeId,
      parsed.data,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya existe una liquidación en proceso (clave de idempotencia duplicada)",
      };
    }
    return toActionError(err);
  }
}

export async function updateTerminationAction(
  companyId: string,
  terminationId: string,
  rawInput: unknown
): Promise<ActionResult<TerminationRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = UpdateTerminationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await TerminationService.update(
      companyId,
      userId,
      terminationId,
      parsed.data,
      ipAddress,
      userAgent
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function finalizeTerminationAction(
  companyId: string,
  terminationId: string
): Promise<ActionResult<TerminationRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  try {
    const data = await TerminationService.finalize(companyId, userId, terminationId, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function getTerminationAction(
  companyId: string,
  terminationId: string
): Promise<ActionResult<TerminationRow | null>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await TerminationService.getById(companyId, terminationId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function listTerminationsAction(
  companyId: string
): Promise<ActionResult<TerminationRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await TerminationService.list(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Anticipo de Prestaciones (Art. 144 LOTTT) ────────────────────────────────

export async function registerBenefitAdvanceAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<BenefitAdvanceRow>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const parsed = RegisterBenefitAdvanceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const data = await BenefitAdvanceService.registerAdvance(companyId, userId, {
      employeeId: parsed.data.employeeId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
    }, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function listBenefitAdvancesAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<BenefitAdvanceRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  try {
    const data = await BenefitAdvanceService.listAdvances(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Backfill Prestaciones Históricas ────────────────────────────────────────
// ADR-015: postea trimestres faltantes al período activo actual.
// Solo ADMIN — operación destructiva (crea múltiples asientos contables).

export async function backfillBenefitsAction(
  companyId: string
): Promise<ActionResult<{ employeesProcessed: number; quartersProcessed: number; totalAccrued: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  try {
    const data = await BenefitAccrualService.backfillAllQuarters(companyId, userId, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

export async function getVacationAlertsAction(
  companyId: string
): Promise<ActionResult<{ employeeId: string; fullName: string; remaining: number; entitlement: number }[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
  if (!ctx.ok) return ctx.error;
  try {
    const data = await VacationService.getEmployeesWithLowVacationBalance(companyId);
    return { success: true, data };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Feature 4: Saldo inicial de prestaciones (migración desde otro sistema) ──
export async function setInitialBenefitBalanceAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<void>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  const { userId, ipAddress, userAgent } = ctx;

  const schema = z.object({
    employeeId: z.string().min(1),
    initialBalance: z.string().refine((v) => {
      try { return new Decimal(v).gte(0); } catch { return false; }
    }, "Saldo debe ser un número no negativo"),
    initialInterestBalance: z.string().refine((v) => {
      try { return new Decimal(v).gte(0); } catch { return false; }
    }, "Saldo de intereses debe ser un número no negativo").optional(),
  });

  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const { employeeId, initialBalance, initialInterestBalance } = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.benefitBalance.upsert({
        where: { employeeId },
        create: {
          companyId,
          employeeId,
          initialBalance: new Decimal(initialBalance),
          initialInterestBalance: new Decimal(initialInterestBalance ?? "0"),
        },
        update: {
          initialBalance: new Decimal(initialBalance),
          initialInterestBalance: new Decimal(initialInterestBalance ?? "0"),
        },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          action: "EMPLOYEE_INITIAL_BENEFIT_SET",
          entityName: "BenefitBalance",
          entityId: employeeId,
          newValue: { initialBalance, initialInterestBalance: initialInterestBalance ?? "0" },
          ipAddress,
          userAgent,
        },
      });
    });

    revalidateNomD(companyId);
    return { success: true, data: undefined };
  } catch (err) {
    return toActionError(err);
  }
}

