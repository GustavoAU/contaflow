"use server";

// Configuración del nivel de control de stock por empresa.
// WARN  → permite facturar con stock negativo (aviso en UI)
// CONFIRM → requiere confirmación explícita antes de facturar con stock insuficiente
// BLOCK → bloquea la emisión si el stock es insuficiente

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const StockControlLevelSchema = z.enum(["WARN", "CONFIRM", "BLOCK"]);

export type StockControlLevel = z.infer<typeof StockControlLevelSchema>;

// ─── Leer nivel actual ────────────────────────────────────────────────────────
export async function getStockControlLevelAction(
  companyId: string,
): Promise<ActionResult<{ level: StockControlLevel }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
    if (!ctx.ok) return ctx.error;

    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
      select: { stockControlLevel: true },
    });

    return {
      success: true,
      data: { level: (settings?.stockControlLevel ?? "WARN") as StockControlLevel },
    };
  } catch (err) {
    return toActionError(err);
  }
}

// ─── Actualizar nivel ─────────────────────────────────────────────────────────
export async function updateStockControlLevelAction(input: unknown): Promise<
  { success: true } | { success: false; error: string }
> {
  const parsed = z.object({
    companyId: z.string().min(1),
    level: StockControlLevelSchema,
  }).safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0].message };

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    await prisma.$transaction(async (tx) => {
      await tx.companySettings.upsert({
        where: { companyId: parsed.data.companyId },
        create: { companyId: parsed.data.companyId, stockControlLevel: parsed.data.level },
        update: { stockControlLevel: parsed.data.level },
      });
      await tx.auditLog.create({
        data: {
          companyId: parsed.data.companyId,
          entityName: "CompanySettings",
          entityId: parsed.data.companyId,
          action: "UPDATE_STOCK_CONTROL_LEVEL",
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          newValue: { stockControlLevel: parsed.data.level },
        },
      });
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true };
  } catch (err) {
    return { success: false, error: mapPrismaError(err) };
  }
}
