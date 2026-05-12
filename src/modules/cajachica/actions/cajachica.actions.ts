"use server";

import { headers } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import {
  CreateCajaCajaSchema,
  CloseCajaCajaSchema,
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

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

async function getIpAndUa() {
  const h = await headers();
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? undefined;
  const userAgent = h.get("user-agent") ?? undefined;
  return { ipAddress, userAgent };
}

async function guardAdmin(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, error: "No autenticado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { ok: false as const, error: "Límite de solicitudes superado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { ok: false as const, error: "No eres miembro de esta empresa" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { ok: false as const, error: "Se requiere rol ADMIN o superior" };

  return { ok: true as const, userId };
}

async function guardOperations(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, error: "No autenticado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { ok: false as const, error: "Límite de solicitudes superado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { ok: false as const, error: "No eres miembro de esta empresa" };
  if (!canAccess(member.role, ROLES.WRITERS))
    return { ok: false as const, error: "Rol insuficiente" };

  return { ok: true as const, userId };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al crear Caja Chica" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al listar cajas" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al cerrar Caja Chica" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al registrar depósito" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al anular depósito" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al registrar gasto" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al aprobar gasto" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al anular gasto" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al crear reembolso" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al publicar reembolso" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error al anular reembolso" };
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
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}
