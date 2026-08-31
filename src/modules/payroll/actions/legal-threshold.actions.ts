"use server";
// src/modules/payroll/actions/legal-threshold.actions.ts
// Ítem 72: Server Actions para gestión de topes legales venezolanos.
//
// Seguridad:
//   - getLegalThresholdsAction: cualquier miembro (ROLES.ALL)
//   - createLegalThresholdAction / deleteLegalThresholdAction: ROLES.ACCOUNTING (OWNER+ADMIN+ACCOUNTANT)
//   - companyMember.findFirst siempre verifica pertenencia (IDOR guard)
//   - rate limit con limiters.fiscal en escrituras

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import Decimal from "decimal.js";
import { LegalThresholdService, type LegalThresholdRow } from "../services/LegalThresholdService";
import type { LegalThresholdType } from "@prisma/client";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const CreateSchema = z.object({
  type: z.enum([
    "SALARY_MIN_VES", "UT_VALUE",
    "IVSS_OBR_RATE", "IVSS_PAT_RATE",
    "INCES_OBR_RATE", "INCES_PAT_RATE",
    "FAOV_OBR_RATE", "FAOV_PAT_RATE",
    "RPE_OBR_RATE", "RPE_PAT_RATE",
  ]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  value: z.string().refine((v) => {
    try { return new Decimal(v).gt(0); } catch { return false; }
  }, "Valor debe ser un número positivo"),
  notes: z.string().max(200).optional(),
});

// ── getLegalThresholdsAction ──────────────────────────────────────────────────
export async function getLegalThresholdsAction(
  companyId: string,
): Promise<ActionResult<LegalThresholdRow[]>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
    if (!ctx.ok) return ctx.error;
    const data = await LegalThresholdService.list(companyId);
    return { success: true, data };
  } catch (e) {
    return toActionError(e);
  }
}

// ── createLegalThresholdAction — ROLES.ACCOUNTING + rate limit ───────────────
export async function createLegalThresholdAction(
  companyId: string,
  rawInput: unknown,
): Promise<ActionResult<LegalThresholdRow>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const parsed = CreateSchema.safeParse(rawInput);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

    const { type, effectiveFrom, value, notes } = parsed.data;

    const data = await LegalThresholdService.create(companyId, {
      type: type as LegalThresholdType,
      effectiveFrom: new Date(effectiveFrom),
      value: new Decimal(value),
      notes,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { success: false, error: "Ya existe un registro para ese tipo y fecha de vigencia" };
    }
    return toActionError(e);
  }
}

// ── deleteLegalThresholdAction — ROLES.ACCOUNTING ────────────────────────────
export async function deleteLegalThresholdAction(
  companyId: string,
  id: string,
): Promise<ActionResult<void>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    await LegalThresholdService.delete(companyId, id, ctx.userId, ctx.ipAddress, ctx.userAgent);
    revalidatePath(`/payroll/legal-thresholds`);
    return { success: true, data: undefined };
  } catch (e) {
    return toActionError(e);
  }
}

// ── confirmThresholdStillValidAction — ACCOUNTING ────────────────────────────
// Registra que alguien COMPROBÓ que este tope sigue vigente.
//
// No cambia el valor: existe porque el sistema no puede saber si salió un
// decreto nuevo. La alerta del dashboard medía la antigüedad de `effectiveFrom`
// —la fecha del decreto— y el salario mínimo venezolano lleva en Bs. 130 desde
// marzo de 2022, así que saltaba todos los días por un dato correcto. Una señal
// permanentemente encendida entrena a ignorarla.
//
// ACCOUNTING y no ADMIN_ONLY: confirmar no altera ninguna cifra, y quien lleva
// la nómina día a día es quien consulta la Gaceta.
export async function confirmThresholdStillValidAction(
  companyId: string,
  thresholdId: string,
): Promise<ActionResult<{ verifiedAt: string }>> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ACCOUNTING,
    limiter: limiters.fiscal,
    captureNet: true,
  });
  if (!ctx.ok) return ctx.error;

  try {
    const { default: prisma } = await import("@/lib/prisma");
    const { Prisma } = await import("@prisma/client");
    const verifiedAt = new Date();

    await prisma.$transaction(async (tx) => {
      // companyId en el where, no en una lectura previa: el id viene del cliente
      // y entre comprobar y escribir cabe otra petición (ADR-004/ADR-044).
      const actualizado = await tx.legalThreshold.updateMany({
        where: { id: thresholdId, companyId },
        data: { verifiedAt },
      });
      if (actualizado.count === 0) {
        throw new Error("El tope no existe o no pertenece a esta empresa");
      }

      // R-6: queda constancia de QUIÉN dio por vigente el valor con el que se
      // calculan las cotizaciones, que es exactamente lo que una fiscalización
      // querría saber si el tope resultara equivocado.
      await tx.auditLog.create({
        data: {
          companyId,
          entityName: "LegalThreshold",
          entityId: thresholdId,
          action: "CONFIRM_LEGAL_THRESHOLD",
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          oldValue: Prisma.JsonNull,
          newValue: { verifiedAt: verifiedAt.toISOString() },
        },
      });
    });

    revalidatePath(`/company/${companyId}/payroll/legal-thresholds`);
    revalidatePath(`/company/${companyId}`);
    return { success: true, data: { verifiedAt: verifiedAt.toISOString() } };
  } catch (err) {
    return toActionError(err);
  }
}
