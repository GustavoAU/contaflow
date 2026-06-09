// src/modules/payroll/actions/payroll-run.actions.ts
// Fase NOM-C: Server Actions para procesos de nómina
//
// Seguridad (ADR-013):
//   NOM-C-01: companyMember.findFirst verifica tenant antes de toda query // ADR-004-EXCEPTION: IDOR guard — where:{userId,companyId} en resolveAuth()
//   NOM-C-02: P2002 del @@unique mapeado a mensaje amigable
//   NOM-C-08: checkRateLimit(limiters.fiscal) en create/approve/cancel
//   NOM-C-09: create/approve/cancel = ADMIN_ONLY; list/get = ACCOUNTING
//   Patrón: auth → role → rateLimit → parse → service

"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { PayrollRunService, type PayrollRunRow, type PayrollRunDetailRow } from "../services/PayrollRunService";
import { PayrollBankTxtService, type BankPaymentFile } from "../services/PayrollBankTxtService";
import {
  CreatePayrollRunSchema,
  ApprovePayrollRunSchema,
  CancelPayrollRunSchema,
} from "../schemas/payroll-run.schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveAuth(companyId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, member: null };
  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId },
  });
  return { userId, member };
}

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/runs`);
}

// ─── getPayrollRunsAction — ACCOUNTING ────────────────────────────────────────
export async function getPayrollRunsAction(
  companyId: string
): Promise<ActionResult<PayrollRunRow[]>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  try {
    const runs = await PayrollRunService.list(companyId);
    return { success: true, data: runs };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── getPayrollRunDetailAction — ACCOUNTING ───────────────────────────────────
// NOM-C-01: IDOR guard via findFirst en PayrollRunService.getById
export async function getPayrollRunDetailAction(
  companyId: string,
  runId: string
): Promise<ActionResult<PayrollRunDetailRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  try {
    const run = await PayrollRunService.getById(companyId, runId);
    if (!run) return { success: false, error: "Proceso de nómina no encontrado" };
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── createPayrollRunAction — ADMIN_ONLY ──────────────────────────────────────
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
// NOM-C-02: P2002 mapeado a mensaje amigable
export async function createPayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina
  if (!await hasModuleAccess(companyId, member.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede procesar nómina" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = CreatePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const run = await PayrollRunService.create(companyId, userId, parsed.data, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    // NOM-C-02: P2002 del @@unique([companyId, periodStart, periodEnd])
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        success: false,
        error: "Ya existe un proceso de nómina para este período. Revisa los borradores existentes.",
      };
    }
    return toActionError(err);
  }
}

// ─── approvePayrollRunAction — ADMIN_ONLY ─────────────────────────────────────
// NOM-C-03: mutex en PayrollRunService.approve (updateMany status:'DRAFT')
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
export async function approvePayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina
  if (!await hasModuleAccess(companyId, member.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede aprobar nómina" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = ApprovePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const run = await PayrollRunService.approve(companyId, userId, parsed.data.runId, ipAddress, userAgent);
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── cancelPayrollRunAction — ADMIN_ONLY ──────────────────────────────────────
// NOM-C-04: solo DRAFT es cancelable — guard en PayrollRunService.cancel
// NOM-C-08: rate limit fiscal
// NOM-C-09: ADMIN_ONLY
export async function cancelPayrollRunAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollRunRow>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina
  if (!await hasModuleAccess(companyId, member.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede cancelar nómina" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  const parsed = CancelPayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const run = await PayrollRunService.cancel(
      companyId,
      userId,
      parsed.data.runId,
      parsed.data.reason,
      ipAddress,
      userAgent
    );
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── exportPayrollBankTxtAction — ACCOUNTING ─────────────────────────────────
// Genera el archivo TXT de pago masivo bancario (Ítem 53).
// Accesible desde ACCOUNTING+ — cualquier rol que pueda ver la nómina puede
// generar el archivo de pago. El contenido lo descarga el cliente, no se persiste.
export async function exportPayrollBankTxtAction(
  companyId: string,
  runId: string,
): Promise<ActionResult<BankPaymentFile>> {
  const { userId, member } = await resolveAuth(companyId);
  if (!userId || !member) return { success: false, error: "No autorizado" };
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  // HIGH-06: rate limit en exportación de datos bancarios sensibles
  const rl = await checkRateLimit(userId, limiters.export);
  if (!rl.allowed) return { success: false, error: "Límite de exportación alcanzado. Intente en unos minutos." };

  try {
    const file = await PayrollBankTxtService.generate(companyId, runId);
    return { success: true, data: file };
  } catch (err) {
    return toActionError(err);
  }
}
