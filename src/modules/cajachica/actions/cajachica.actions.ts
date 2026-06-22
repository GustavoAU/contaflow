"use server";

import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import type { UserRole } from "@prisma/client";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { mapPrismaError } from "@/lib/prisma-errors";
import {
  CreateCajaCajaSchema,
  CloseCajaCajaSchema,
  AssignCustodianSchema,
  ReopenCajaCajaSchema,
  CreateDepositSchema,
  VoidDepositSchema,
  CreateMovementSchema,
  ApproveMovementSchema,
  VoidMovementSchema,
  CreateReimbursementSchema,
  PostReimbursementSchema,
  VoidReimbursementSchema,
} from "../schemas/cajachica.schema";
import {
  createCajaCaja,
  listCajasCajas,
  getCajaCajaById,
  closeCajaCaja,
  assignCustodian,
  reopenCajaCaja,
  type CajaCajaSummary,
} from "../services/CajaCajaService";
import {
  createDeposit,
  voidDeposit,
  listDeposits,
  type DepositSummary,
} from "../services/CajaCajaDepositService";
import {
  createMovement,
  approveMovement,
  voidMovement,
  listMovements,
  type MovementSummary,
} from "../services/CajaCajaMovementService";
import {
  createReimbursement,
  postReimbursement,
  voidReimbursement,
  listReimbursements,
  type ReimbursementSummary,
} from "../services/CajaCajaReimbursementService";
import {
  generateCajaCajaCSV,
  generateCajaCajaPDF,
  type CajaCajaExportData,
} from "../services/CajaCajaExportService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { logRejection, shouldLogRejection } from "../utils/log-rejection";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getIpAndUa() {
  const h = await headers();
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? undefined;
  const userAgent = h.get("user-agent") ?? undefined;
  return { ipAddress, userAgent };
}

// HC-08 (ADR-037 D-2): registra el rechazo de regla de negocio (best-effort, fuera del
// $transaction) ANTES de devolver el error al usuario. `reason` = el MISMO mensaje de
// negocio que ve el usuario (mapPrismaError), nunca input crudo (sin PII). El comportamiento
// hacia el usuario no cambia: igual se devuelve toActionError(e).
async function rejectAndReport(
  e: unknown,
  meta: {
    companyId: string;
    userId: string;
    action: string;
    entityName: string;
    entityId?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<ActionResult<never>> {
  if (shouldLogRejection(e)) {
    await logRejection({
      companyId: meta.companyId,
      userId: meta.userId,
      action: meta.action,
      entityName: meta.entityName,
      entityId: meta.entityId,
      reason: mapPrismaError(e),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
  return toActionError(e);
}

type GuardResult = { ok: true; userId: string } | { ok: false; error: string };

async function guardRole(
  companyId: string,
  roles: UserRole[],
  roleError: string,
): Promise<GuardResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "No autenticado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { ok: false, error: "Límite de solicitudes superado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { ok: false, error: "No eres miembro de esta empresa" };
  if (!canAccess(member.role, roles)) return { ok: false, error: roleError };

  return { ok: true, userId };
}

function guardAdmin(companyId: string): Promise<GuardResult> {
  return guardRole(companyId, ROLES.ADMIN_ONLY, "Se requiere rol ADMIN o superior");
}

function guardOperations(companyId: string): Promise<GuardResult> {
  return guardRole(companyId, ROLES.WRITERS, "Rol insuficiente");
}

// ─── CajaCaja ─────────────────────────────────────────────────────────────────

export async function createCajaCajaAction(
  raw: unknown
): Promise<ActionResult<CajaCajaSummary>> {
  const parsed = CreateCajaCajaSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await createCajaCaja(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "CREATE_CAJACAJA",
      entityName: "CajaCaja",
      ipAddress,
      userAgent,
    });
  }
}

export async function listCajasCajasAction(
  companyId: string
): Promise<ActionResult<CajaCajaSummary[]>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await listCajasCajas(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function getCajaCajaByIdAction(
  cajaCajaId: string,
  companyId: string
): Promise<ActionResult<CajaCajaSummary | null>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await getCajaCajaById(cajaCajaId, companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

export async function closeCajaCajaAction(
  raw: unknown
): Promise<ActionResult<void>> {
  const parsed = CloseCajaCajaSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    await closeCajaCaja(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data: undefined };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "CLOSE_CAJACAJA",
      entityName: "CajaCaja",
      entityId: parsed.data.cajaCajaId,
      ipAddress,
      userAgent,
    });
  }
}

export async function reopenCajaCajaAction(
  raw: unknown
): Promise<ActionResult<void>> {
  const parsed = ReopenCajaCajaSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    await reopenCajaCaja(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data: undefined };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "REOPEN_CAJACAJA",
      entityName: "CajaCaja",
      entityId: parsed.data.cajaCajaId,
      ipAddress,
      userAgent,
    });
  }
}

export async function assignCustodianAction(
  raw: unknown
): Promise<ActionResult<CajaCajaSummary>> {
  const parsed = AssignCustodianSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await assignCustodian(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "ASSIGN_CUSTODIAN",
      entityName: "CajaCaja",
      entityId: parsed.data.cajaCajaId,
      ipAddress,
      userAgent,
    });
  }
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

export async function createDepositAction(
  raw: unknown
): Promise<ActionResult<DepositSummary>> {
  const parsed = CreateDepositSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await createDeposit(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "CREATE_DEPOSIT",
      entityName: "CajaCajaDeposit",
      ipAddress,
      userAgent,
    });
  }
}

export async function voidDepositAction(
  raw: unknown
): Promise<ActionResult<void>> {
  const parsed = VoidDepositSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    await voidDeposit(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data: undefined };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "VOID_DEPOSIT",
      entityName: "CajaCajaDeposit",
      entityId: parsed.data.depositId,
      ipAddress,
      userAgent,
    });
  }
}

export async function listDepositsAction(
  cajaCajaId: string,
  companyId: string
): Promise<ActionResult<DepositSummary[]>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await listDeposits(cajaCajaId, companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── Movements ────────────────────────────────────────────────────────────────

export async function createMovementAction(
  raw: unknown
): Promise<ActionResult<MovementSummary>> {
  const parsed = CreateMovementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardOperations(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await createMovement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "CREATE_MOVEMENT",
      entityName: "CajaCajaMovement",
      ipAddress,
      userAgent,
    });
  }
}

export async function approveMovementAction(
  raw: unknown
): Promise<ActionResult<MovementSummary>> {
  const parsed = ApproveMovementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await approveMovement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "APPROVE_MOVEMENT",
      entityName: "CajaCajaMovement",
      entityId: parsed.data.movementId,
      ipAddress,
      userAgent,
    });
  }
}

export async function voidMovementAction(
  raw: unknown
): Promise<ActionResult<void>> {
  const parsed = VoidMovementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    await voidMovement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data: undefined };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "VOID_MOVEMENT",
      entityName: "CajaCajaMovement",
      entityId: parsed.data.movementId,
      ipAddress,
      userAgent,
    });
  }
}

export async function listMovementsAction(
  cajaCajaId: string,
  companyId: string
): Promise<ActionResult<MovementSummary[]>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await listMovements(cajaCajaId, companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── Reimbursements ───────────────────────────────────────────────────────────

export async function createReimbursementAction(
  raw: unknown
): Promise<ActionResult<ReimbursementSummary>> {
  const parsed = CreateReimbursementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await createReimbursement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "CREATE_REIMBURSEMENT",
      entityName: "CajaCajaReimbursement",
      ipAddress,
      userAgent,
    });
  }
}

export async function postReimbursementAction(
  raw: unknown
): Promise<ActionResult<ReimbursementSummary>> {
  const parsed = PostReimbursementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    const data = await postReimbursement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "POST_REIMBURSEMENT",
      entityName: "CajaCajaReimbursement",
      entityId: parsed.data.reimbursementId,
      ipAddress,
      userAgent,
    });
  }
}

export async function voidReimbursementAction(
  raw: unknown
): Promise<ActionResult<void>> {
  const parsed = VoidReimbursementSchema.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const g = await guardAdmin(parsed.data.companyId);
  if (!g.ok) return { success: false, error: g.error };

  const { ipAddress, userAgent } = await getIpAndUa();
  try {
    await voidReimbursement(parsed.data, g.userId, ipAddress, userAgent);
    return { success: true, data: undefined };
  } catch (e) {
    return rejectAndReport(e, {
      companyId: parsed.data.companyId,
      userId: g.userId,
      action: "VOID_REIMBURSEMENT",
      entityName: "CajaCajaReimbursement",
      entityId: parsed.data.reimbursementId,
      ipAddress,
      userAgent,
    });
  }
}

export async function listReimbursementsAction(
  cajaCajaId: string,
  companyId: string
): Promise<ActionResult<ReimbursementSummary[]>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await listReimbursements(cajaCajaId, companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── Export (arqueo por caja — CSV / PDF, descarga de conveniencia) ──────────────

async function buildCajaExportData(
  cajaCajaId: string,
  companyId: string,
): Promise<CajaCajaExportData | null> {
  const caja = await getCajaCajaById(cajaCajaId, companyId);
  if (!caja) return null;
  const [movements, deposits, company] = await Promise.all([
    listMovements(cajaCajaId, companyId),
    listDeposits(cajaCajaId, companyId),
    prisma.company.findFirst({ where: { id: companyId }, select: { name: true } }),
  ]);
  return {
    companyName: company?.name ?? "",
    caja: {
      name: caja.name,
      accountCode: caja.accountCode,
      accountName: caja.accountName,
      currency: caja.currency,
      status: caja.status,
      custodianName: caja.custodianName,
      totalDeposited: caja.totalDeposited,
      totalApprovedMovements: caja.totalApprovedMovements,
      totalPendingMovements: caja.totalPendingMovements,
      availableBalance: caja.availableBalance,
    },
    movements: movements.map((m) => ({
      date: m.date,
      voucherNumber: m.voucherNumber,
      concept: m.concept,
      expenseAccountCode: m.expenseAccountCode,
      expenseAccountName: m.expenseAccountName,
      providerRif: m.providerRif,
      supportingDocumentId: m.supportingDocumentId,
      amount: m.amount,
      currency: m.currency,
      status: m.status,
    })),
    deposits: deposits.map((d) => ({
      date: d.date,
      amount: d.amount,
      description: d.description,
      status: d.status,
    })),
    generatedAt: new Date(),
  };
}

function exportFilename(caja: CajaCajaExportData["caja"], ext: string): string {
  const slug = caja.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "caja-chica";
  const stamp = new Date().toISOString().slice(0, 10);
  return `arqueo-${slug}-${stamp}.${ext}`;
}

export async function exportCajaCajaCSVAction(
  cajaCajaId: string,
  companyId: string,
): Promise<ActionResult<{ csv: string; filename: string }>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await buildCajaExportData(cajaCajaId, companyId);
    if (!data) return { success: false, error: "Caja Chica no encontrada" };
    return { success: true, data: { csv: generateCajaCajaCSV(data), filename: exportFilename(data.caja, "csv") } };
  } catch (e) {
    return toActionError(e);
  }
}

export async function exportCajaCajaPDFAction(
  cajaCajaId: string,
  companyId: string,
): Promise<ActionResult<{ pdf: string; filename: string }>> {
  const g = await guardOperations(companyId);
  if (!g.ok) return { success: false, error: g.error };

  try {
    const data = await buildCajaExportData(cajaCajaId, companyId);
    if (!data) return { success: false, error: "Caja Chica no encontrada" };
    const buffer = await generateCajaCajaPDF(data);
    return { success: true, data: { pdf: buffer.toString("base64"), filename: exportFilename(data.caja, "pdf") } };
  } catch (e) {
    return toActionError(e);
  }
}
