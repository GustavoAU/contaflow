"use server";
// src/modules/payroll/actions/payroll-config.actions.ts
// Fase NOM-A: Server Actions para configuración de nómina
//
// Security findings addressed (audit NOM-A 2026-04-15):
//   NOM-A-01 (CRITICAL): companyId siempre verificado via companyMember.findFirst
//   NOM-A-02 (CRITICAL): UPSERT en $transaction con AuditLog — ver PayrollConfigService
//   NOM-A-03 (HIGH):     ivssEnabled/incesEnabled/banavihEnabled son toggles fiscales;
//                        requieren confirmación en UI y ADMIN_ONLY + AuditLog completo
//   NOM-A-04 (HIGH):     rate limit con limiters.fiscal en savePayrollConfigAction
//   NOM-A-05 (HIGH):     write = ADMIN_ONLY, read = cualquier miembro (VIEWER solo status)

import { revalidatePath } from "next/cache";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { PayrollConfigSchema } from "../schemas/payroll-config.schema";
import { PayrollConfigService } from "../services/PayrollConfigService";
import type { PayrollConfigRow } from "../services/PayrollConfigService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ── savePayrollConfigAction — ADMIN_ONLY + rate limit ─────────────────────────
// NOM-A-05: Solo OWNER y ADMIN pueden crear/actualizar la configuración de nómina.
// Equivalente a "Configuración de empresa" — decisión de gerencia, no de contabilidad.
export async function savePayrollConfigAction(
  companyId: string,
  rawInput: unknown
): Promise<ActionResult<PayrollConfigRow>> {
  // NOM-A-05: solo ADMIN_ONLY puede escribir configuración de nómina
  // NOM-A-04: rate limit — es una mutación fiscal
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = PayrollConfigSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  try {
    const cfg = await PayrollConfigService.saveConfig(companyId, ctx.userId, parsed.data, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/company/${companyId}/payroll`);
    return { success: true, data: cfg };
  } catch (err) {
    return toActionError(err);
  }
}

// ── getPayrollConfigAction — cualquier miembro (excl. VIEWER) ─────────────────
// Un ACCOUNTANT necesita leer la config para entender qué contribuciones se calculan.
export async function getPayrollConfigAction(
  companyId: string
): Promise<ActionResult<PayrollConfigRow | null>> {
  // VIEWER no tiene acceso a detalles de configuración de nómina
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  const cfg = await PayrollConfigService.getConfig(companyId);
  return { success: true, data: cfg };
}

// ── getPayrollConfigStatusAction — cualquier miembro (incluyendo VIEWER) ──────
// Retorna solo si el wizard fue completado. Usado para mostrar "Configuración pendiente".
export async function getPayrollConfigStatusAction(
  companyId: string
): Promise<ActionResult<{ configured: boolean }>> {
  // NOM-A-06: sin auth en action = info disclosure
  const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
  if (!ctx.ok) return ctx.error;

  const configured = await PayrollConfigService.isConfigured(companyId);
  return { success: true, data: { configured } };
}

// ── setAutoDraftAction — ADMIN_ONLY ──────────────────────────────────────────
// Activa o desactiva el borrador automático de nómina.
//
// ADMIN_ONLY y con AuditLog porque no es una preferencia cosmética: decide si el
// sistema escribe procesos de nómina solo. Un borrador creado por el cron
// reserva las horas extra del período y ocupa su ranura, así que quién lo activó
// y cuándo tiene que quedar registrado.
export async function setAutoDraftAction(
  companyId: string,
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  if (typeof enabled !== "boolean") {
    return { success: false, error: "Valor inválido" };
  }

  try {
    const { default: prisma } = await import("@/lib/prisma");
    const { Prisma } = await import("@prisma/client");

    await prisma.$transaction(async (tx) => {
      // companyId en el where del update, no una lectura previa: entre comprobar
      // y escribir cabe otra petición.
      const actualizado = await tx.payrollConfig.updateMany({
        where: { companyId },
        data: { autoDraftEnabled: enabled },
      });
      if (actualizado.count === 0) {
        throw new Error("Configure la nómina antes de activar el borrador automático");
      }

      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "PayrollConfig",
          entityId: companyId,
          action: enabled ? "ENABLE_PAYROLL_AUTO_DRAFT" : "DISABLE_PAYROLL_AUTO_DRAFT",
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          oldValue: Prisma.JsonNull,
          newValue: { autoDraftEnabled: enabled },
        },
      });
    });

    revalidatePath(`/company/${companyId}/payroll`);
    revalidatePath(`/company/${companyId}/payroll/runs`);
    return { success: true, data: { enabled } };
  } catch (err) {
    return toActionError(err);
  }
}
