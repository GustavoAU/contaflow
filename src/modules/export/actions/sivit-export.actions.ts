"use server";

// src/modules/export/actions/sivit-export.actions.ts
import { z } from "zod";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { generateSIVITZip } from "../services/SIVITExportService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const SIVITExportSchema = z.object({
  companyId: z.string().min(1),
  dateFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
  dateTo:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

export async function generateSIVITAction(
  input: unknown
): Promise<ActionResult<{ base64Zip: string; filename: string }>> {
  const parsed = SIVITExportSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const { companyId, dateFrom, dateTo } = parsed.data;

    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.export,
    });
    if (!ctx.ok) return ctx.error;

    const from = new Date(dateFrom + "T00:00:00Z");
    const to   = new Date(dateTo   + "T23:59:59Z");

    if (to < from) return { success: false, error: "La fecha de fin debe ser posterior a la de inicio" };

    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 366) return { success: false, error: "El rango máximo es 366 días" };

    const buffer = await generateSIVITZip({ companyId, dateFrom: from, dateTo: to });
    const base64Zip = buffer.toString("base64");
    const filename = `SIVIT_${dateFrom}_${dateTo}.zip`;

    return { success: true, data: { base64Zip, filename } };
  } catch (err) {
    return toActionError(err);
  }
}
