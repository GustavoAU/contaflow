"use server";
// src/modules/payroll/actions/vacation-request.actions.ts
// Feature 8/9/10: Server Actions para flujo de solicitudes de vacaciones.
//
// Seguridad:
//   - getVacationRequestsAction / getVacationBalanceAction: cualquier miembro (ROLES.ALL)
//   - createVacationRequestAction: ROLES.WRITERS (el empleado/contador crea la solicitud)
//   - approveVacationRequestAction / rejectVacationRequestAction: ROLES.ACCOUNTING
//   - cancelVacationRequestAction: ROLES.WRITERS (el solicitante puede cancelar)
//   - setInitialVacationBalanceAction: ROLES.ACCOUNTING
//   - companyMember.findFirst siempre verifica pertenencia (IDOR guard)
//   - rate limit con limiters.fiscal en escrituras

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import type { UserRole } from "@prisma/client";
import Decimal from "decimal.js";
import {
  VacationRequestService,
  type VacationRequestRow,
  type VacationBalanceRow,
} from "../services/VacationRequestService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Guards ───────────────────────────────────────────────────────────────────

async function guardMember(
  companyId: string
): Promise<{ userId: string; role: UserRole } | { success: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ALL))
    return { success: false, error: "Acceso denegado" };
  return { userId, role: member.role };
}

async function getIpUa(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  daysRequested: z.string().refine((v) => {
    try { return new Decimal(v).gt(0); } catch { return false; }
  }, "Los días deben ser un número positivo"),
  notes: z.string().max(500).optional(),
});

const RejectSchema = z.object({
  rejectionReason: z.string().min(1, "Motivo de rechazo requerido").max(500),
});

const InitialBalanceSchema = z.object({
  employeeId: z.string().min(1),
  initialVacationDays: z.string().refine((v) => {
    try { return new Decimal(v).gte(0); } catch { return false; }
  }, "El saldo debe ser un número no negativo"),
});

// ─── getVacationRequestsAction ────────────────────────────────────────────────
export async function getVacationRequestsAction(
  companyId: string,
  employeeId?: string
): Promise<ActionResult<VacationRequestRow[]>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    const data = employeeId
      ? await VacationRequestService.listByEmployee(companyId, employeeId)
      : await VacationRequestService.listPending(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── getVacationBalanceAction ─────────────────────────────────────────────────
export async function getVacationBalanceAction(
  companyId: string,
  employeeId: string
): Promise<ActionResult<VacationBalanceRow>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    const data = await VacationRequestService.getBalance(companyId, employeeId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── createVacationRequestAction ─────────────────────────────────────────────
export async function createVacationRequestAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<VacationRequestRow>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    if (!canAccess(guard.role, ROLES.WRITERS))
      return { success: false, error: "Se requiere rol Escritor o superior" };

    const rl = await checkRateLimit(guard.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = CreateSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { employeeId, startDate, endDate, daysRequested, notes } = parsed.data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return { success: false, error: "La fecha de fin no puede ser anterior al inicio" };

    const { ipAddress, userAgent } = await getIpUa();
    const data = await VacationRequestService.create(companyId, {
      employeeId,
      startDate: start,
      endDate: end,
      daysRequested: new Decimal(daysRequested),
      notes,
      createdByUserId: guard.userId,
      ipAddress,
      userAgent,
    });

    revalidatePath(`/company/${companyId}/payroll/employees/${employeeId}`);
    revalidatePath(`/company/${companyId}/payroll/vacation-requests`);
    revalidatePath(`/company/${companyId}`);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── approveVacationRequestAction ────────────────────────────────────────────
export async function approveVacationRequestAction(
  companyId: string,
  requestId: string
): Promise<ActionResult<VacationRequestRow>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    if (!canAccess(guard.role, ROLES.ACCOUNTING))
      return { success: false, error: "Se requiere rol Administrador o Contador" };

    const rl = await checkRateLimit(guard.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const { ipAddress, userAgent } = await getIpUa();
    const data = await VacationRequestService.approve(
      companyId, requestId, guard.userId, ipAddress, userAgent
    );

    revalidatePath(`/company/${companyId}/payroll/vacation-requests`);
    revalidatePath(`/company/${companyId}`);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── rejectVacationRequestAction ─────────────────────────────────────────────
export async function rejectVacationRequestAction(
  companyId: string,
  requestId: string,
  rawInput: unknown
): Promise<ActionResult<VacationRequestRow>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    if (!canAccess(guard.role, ROLES.ACCOUNTING))
      return { success: false, error: "Se requiere rol Administrador o Contador" };

    const rl = await checkRateLimit(guard.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = RejectSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { ipAddress, userAgent } = await getIpUa();
    const data = await VacationRequestService.reject(
      companyId, requestId, guard.userId, parsed.data.rejectionReason, ipAddress, userAgent
    );

    revalidatePath(`/company/${companyId}/payroll/vacation-requests`);
    revalidatePath(`/company/${companyId}`);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── cancelVacationRequestAction ─────────────────────────────────────────────
export async function cancelVacationRequestAction(
  companyId: string,
  requestId: string
): Promise<ActionResult<VacationRequestRow>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    if (!canAccess(guard.role, ROLES.WRITERS))
      return { success: false, error: "Se requiere rol Escritor o superior" };

    const { ipAddress, userAgent } = await getIpUa();
    const data = await VacationRequestService.cancel(
      companyId, requestId, guard.userId, ipAddress, userAgent
    );

    revalidatePath(`/company/${companyId}/payroll/vacation-requests`);
    revalidatePath(`/company/${companyId}`);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ─── setInitialVacationBalanceAction — Feature 4 ─────────────────────────────
export async function setInitialVacationBalanceAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<void>> {
  try {
    const guard = await guardMember(companyId);
    if ("error" in guard) return guard;
    if (!canAccess(guard.role, ROLES.ACCOUNTING))
      return { success: false, error: "Se requiere rol Administrador o Contador" };

    const rl = await checkRateLimit(guard.userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const parsed = InitialBalanceSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { ipAddress, userAgent } = await getIpUa();
    await VacationRequestService.setInitialVacationBalance(
      companyId,
      parsed.data.employeeId,
      new Decimal(parsed.data.initialVacationDays),
      guard.userId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company/${companyId}/payroll/employees/${parsed.data.employeeId}`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
