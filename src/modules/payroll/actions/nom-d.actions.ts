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

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
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

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveAuth(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, member: null };
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
  });
  return { userId, member };
}

function revalidateNomD(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/benefits`);
  revalidatePath(`/company/${companyId}/payroll/terminations`);
}

function handlePrismaError(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return "Ya existe un registro con estos datos (duplicado)";
    if (err.code === "P2003") return "Datos de referencia inválidos";
  }
  if (err instanceof Error) return err.message;
  return "Error inesperado";
}

// ─── BCV Rate ─────────────────────────────────────────────────────────────────

export async function createBcvRateAction(
  companyId: string,
  rawInput: unknown
): Promise<Result<BcvRateRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

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
      parsed.data.rateType
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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function listBcvRatesAction(
  companyId: string
): Promise<Result<BcvRateRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await BenefitAccrualService.listBcvRates(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Prestaciones: Acumulación Trimestral ─────────────────────────────────────

export async function accrueQuarterAction(
  companyId: string,
  rawInput: unknown
): Promise<Result<{ employeesProcessed: number; totalAccrued: string }>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = AccrueQuarterSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Prestaciones: Intereses BCV ─────────────────────────────────────────────
// CRÍTICO: NO recibe rate — siempre de BcvBenefitRate tabla (ADR-014 Dec. 2 / CRITICAL-3)

export async function postBenefitInterestAction(
  companyId: string,
  rawInput: unknown
): Promise<Result<{ employeesProcessed: number; totalInterest: string }>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = PostBenefitInterestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h2 = await headers();
  const ipAddress2 = h2.get("x-real-ip") ?? h2.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent2 = (h2.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const data = await BenefitAccrualService.postBenefitInterest(
      companyId,
      userId,
      parsed.data.year,
      parsed.data.month,
      ipAddress2,
      userAgent2
    );
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Prestaciones: Saldo del empleado ────────────────────────────────────────

export async function getBenefitBalanceAction(
  companyId: string,
  employeeId: string
): Promise<Result<BenefitBalanceRow | null>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await BenefitAccrualService.getBalance(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Vacaciones ───────────────────────────────────────────────────────────────

export async function createVacationAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<Result<VacationRecordRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = CreateVacationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function listVacationsAction(
  companyId: string,
  employeeId: string
): Promise<Result<VacationRecordRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await VacationService.listByEmployee(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

export async function calculateProfitSharingAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<Result<ProfitSharingRecordRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = CalculateProfitSharingSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function listProfitSharingAction(
  companyId: string,
  employeeId: string
): Promise<Result<ProfitSharingRecordRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await ProfitSharingService.listByEmployee(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Liquidación Final ────────────────────────────────────────────────────────

export async function createTerminationAction(
  companyId: string,
  employeeId: string,
  rawInput: unknown
): Promise<Result<TerminationRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = CreateTerminationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function updateTerminationAction(
  companyId: string,
  terminationId: string,
  rawInput: unknown
): Promise<Result<TerminationRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = UpdateTerminationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function finalizeTerminationAction(
  companyId: string,
  terminationId: string
): Promise<Result<TerminationRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const data = await TerminationService.finalize(companyId, userId, terminationId, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function getTerminationAction(
  companyId: string,
  terminationId: string
): Promise<Result<TerminationRow | null>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await TerminationService.getById(companyId, terminationId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function listTerminationsAction(
  companyId: string
): Promise<Result<TerminationRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await TerminationService.list(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Anticipo de Prestaciones (Art. 144 LOTTT) ────────────────────────────────

export async function registerBenefitAdvanceAction(
  companyId: string,
  rawInput: unknown
): Promise<Result<BenefitAdvanceRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const parsed = RegisterBenefitAdvanceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function listBenefitAdvancesAction(
  companyId: string,
  employeeId: string
): Promise<Result<BenefitAdvanceRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return { success: false, error: "Se requiere rol de Contador o superior" };
  }

  try {
    const data = await BenefitAdvanceService.listAdvances(companyId, employeeId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

// ─── Backfill Prestaciones Históricas ────────────────────────────────────────
// ADR-015: postea trimestres faltantes al período activo actual.
// Solo ADMIN — operación destructiva (crea múltiples asientos contables).

export async function backfillBenefitsAction(
  companyId: string
): Promise<Result<{ employeesProcessed: number; quartersProcessed: number; totalAccrued: string }>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador" };
  }

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Límite de solicitudes excedido" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const data = await BenefitAccrualService.backfillAllQuarters(companyId, userId, ipAddress, userAgent);
    revalidateNomD(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

export async function getVacationAlertsAction(
  companyId: string
): Promise<Result<{ employeeId: string; fullName: string; remaining: number; entitlement: number }[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol de Administrador o superior" };
  }
  try {
    const data = await VacationService.getEmployeesWithLowVacationBalance(companyId);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: handlePrismaError(err) };
  }
}

