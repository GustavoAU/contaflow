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

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { p2002TargetIncludes } from "@/lib/prisma-errors";
import { PayrollRunService, type PayrollRunRow, type PayrollRunDetailRow } from "../services/PayrollRunService";
import { PayrollBankTxtService, type BankPaymentFile } from "../services/PayrollBankTxtService";
import {
  CreatePayrollRunSchema,
  ApprovePayrollRunSchema,
  CancelPayrollRunSchema,
  AddManualLineSchema,
} from "../schemas/payroll-run.schema";

// ─── Tipos ────────────────────────────────────────────────────────────────────

import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

function revalidate(companyId: string) {
  revalidatePath(`/company/${companyId}/payroll/runs`);
}

// ─── getPayrollRunsAction — ACCOUNTING ────────────────────────────────────────
export async function getPayrollRunsAction(
  companyId: string
): Promise<ActionResult<PayrollRunRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

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
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

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
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CreatePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.create(companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    // NOM-C-02: P2002 del @@unique([companyId, periodStart, periodEnd]).
    //
    // Acotado por `meta.target` (auditoría LOW): PayrollRun tiene DOS uniques
    // compuestos —el del período y el de `idempotencyKey`— así que un
    // doble-submit salía con el mensaje del período, que es FALSO y manda al
    // usuario a buscar un borrador que no existe.
    // El nombre del ÍNDICE, no la columna: el `@@unique` del período se
    // reemplazó por un único PARCIAL (migración 20260830), y para un índice que
    // Prisma no declara `meta.target` trae su nombre. La comparación es EXACTA,
    // así que buscar "periodStart" dejaba esta rama muerta y el usuario caía en
    // el mensaje genérico. Es el precedente de CLAUDE.md: la columna es la del
    // CONSTRAINT, no la del documento. Se conservan ambas formas porque
    // `meta.target` no tiene forma estable.
    if (
      p2002TargetIncludes(err, "periodStart") ||
      p2002TargetIncludes(err, "PayrollRun_companyId_period_segment_active_key")
    ) {
      return {
        success: false,
        error: "Ya existe un proceso de nómina vigente para este período y esta moneda. Revisa los borradores existentes.",
      };
    }
    if (p2002TargetIncludes(err, "idempotencyKey")) {
      return {
        success: false,
        error: "Esta solicitud ya se envió. Revisa si el proceso de nómina se creó antes de reintentar.",
      };
    }
    // P2002 sin `meta.target`: no se puede saber CUÁL de los dos uniques chocó.
    // Se responde algo cierto en ambos casos en vez de adivinar — que era el bug.
    // El mensaje genérico de `mapPrismaError` ("Ya existe un registro con esos
    // datos") no le dice al usuario dónde mirar.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        success: false,
        error: "Ya existe un proceso de nómina con esos datos. Revisa los borradores existentes antes de reintentar.",
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
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = ApprovePayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.approve(companyId, ctx.userId, parsed.data.runId, ctx.ipAddress, ctx.userAgent);
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
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  // ADR-025: verifica acceso base + grants granulares al módulo Nómina (check extra tras el guard)
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = CancelPayrollRunSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const run = await PayrollRunService.cancel(
      companyId,
      ctx.userId,
      parsed.data.runId,
      parsed.data.reason,
      ctx.ipAddress,
      ctx.userAgent
    );
    revalidate(companyId);
    return { success: true, data: run };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── addManualPayrollLineAction — ADMIN_ONLY ─────────────────────────────────
// Concepto puntual sobre un borrador: retención de ISLR, un bono de una vez, un
// descuento acordado. ADMIN_ONLY igual que crear/aprobar/cancelar: mueve el neto
// a pagar de un trabajador.
export async function addManualPayrollLineAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<{ id: string; conceptCode: string; amount: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;
  if (!await hasModuleAccess(companyId, ctx.role, "payroll"))
    return { success: false, error: moduleAccessError("payroll") };

  const parsed = AddManualLineSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const line = await PayrollRunService.addManualLine(
      companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent,
    );
    revalidate(companyId);
    return { success: true, data: line };
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
  // HIGH-06: rate limit en exportación de datos bancarios sensibles
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING, limiter: limiters.export });
  if (!ctx.ok) return ctx.error;

  try {
    const file = await PayrollBankTxtService.generate(companyId, runId);
    return { success: true, data: file };
  } catch (err) {
    return toActionError(err);
  }
}
