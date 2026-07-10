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

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { limiters } from "@/lib/ratelimit";
import Decimal from "decimal.js";
import {
  VacationRequestService,
  type VacationRequestRow,
  type VacationBalanceRow,
} from "../services/VacationRequestService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
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
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
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
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = CreateSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { employeeId, startDate, endDate, daysRequested, notes } = parsed.data;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return { success: false, error: "La fecha de fin no puede ser anterior al inicio" };

    const data = await VacationRequestService.create(companyId, {
      employeeId,
      startDate: start,
      endDate: end,
      daysRequested: new Decimal(daysRequested),
      notes,
      createdByUserId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
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
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const data = await VacationRequestService.approve(
      companyId, requestId, ctx.userId, ctx.ipAddress, ctx.userAgent
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
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = RejectSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const data = await VacationRequestService.reject(
      companyId, requestId, ctx.userId, parsed.data.rejectionReason, ctx.ipAddress, ctx.userAgent
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
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.WRITERS,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const data = await VacationRequestService.cancel(
      companyId, requestId, ctx.userId, ctx.ipAddress, ctx.userAgent
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
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = InitialBalanceSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    await VacationRequestService.setInitialVacationBalance(
      companyId,
      parsed.data.employeeId,
      new Decimal(parsed.data.initialVacationDays),
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent
    );

    revalidatePath(`/company/${companyId}/payroll/employees/${parsed.data.employeeId}`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}
