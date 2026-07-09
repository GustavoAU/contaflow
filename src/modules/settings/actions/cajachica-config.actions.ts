"use server";

// ADR-039 (nota #3): umbral (VES) configurable por empresa a partir del cual el
// cierre/reapertura de caja chica exige step-up 2FA. Si está vacío/null se usa el
// default global CAJA_CHICA_STEP_UP_THRESHOLD_VES. Editar = ADMIN_ONLY (el umbral es
// en sí un control de seguridad: quien lo sube debilita el step-up).

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { mapPrismaError } from "@/lib/prisma-errors";
import { CAJA_CHICA_STEP_UP_THRESHOLD_VES } from "@/lib/step-up";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

// ─── Leer umbral actual ─────────────────────────────────────────────────────────
export async function getCajaChicaStepUpThresholdAction(
  companyId: string,
): Promise<ActionResult<{ threshold: string | null; defaultThreshold: string }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
      select: { cajaChicaStepUpThresholdVes: true },
    });
    const v = settings?.cajaChicaStepUpThresholdVes;
    return {
      success: true,
      data: {
        threshold: v != null ? new Decimal(v.toString()).toFixed(2) : null,
        defaultThreshold: new Decimal(CAJA_CHICA_STEP_UP_THRESHOLD_VES).toFixed(2),
      },
    };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Actualizar umbral ──────────────────────────────────────────────────────────
const UpdateSchema = z.object({
  companyId: z.string().min(1),
  // "" / undefined → limpiar (usa el default global). Si viene valor, debe ser > 0.
  threshold: z.string().trim().optional(),
});

export async function updateCajaChicaStepUpThresholdAction(
  input: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    // Validar el monto DESPUÉS de auth + rol (gate security-agent: no hacer trabajo de
    // parseo/Decimal para peticiones no autenticadas). vacío → null (default); con valor → Decimal > 0 y acotado.
    let value: Decimal | null = null;
    const raw = parsed.data.threshold;
    if (raw && raw.length > 0) {
      let dec: Decimal;
      try {
        dec = new Decimal(raw);
      } catch {
        return { success: false, error: "Umbral inválido" };
      }
      if (!dec.isFinite() || dec.lessThanOrEqualTo(0)) {
        return { success: false, error: "El umbral debe ser un monto positivo" };
      }
      if (dec.greaterThan("999999999999999")) {
        return { success: false, error: "El umbral es demasiado grande" };
      }
      value = dec.toDecimalPlaces(2);
    }

    const dbValue = value === null ? null : value.toFixed(2);

    await prisma.$transaction(async (tx) => {
      await tx.companySettings.upsert({
        where: { companyId: parsed.data.companyId },
        create: { companyId: parsed.data.companyId, cajaChicaStepUpThresholdVes: dbValue },
        update: { cajaChicaStepUpThresholdVes: dbValue },
      });
      await tx.auditLog.create({
        data: {
          companyId: parsed.data.companyId,
          entityName: "CompanySettings",
          entityId: parsed.data.companyId,
          action: "UPDATE_CAJACHICA_STEPUP_THRESHOLD",
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          newValue: { cajaChicaStepUpThresholdVes: dbValue },
        },
      });
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}
