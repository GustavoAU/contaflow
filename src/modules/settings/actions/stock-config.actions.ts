"use server";

// Configuración del nivel de control de stock por empresa.
// WARN  → permite facturar con stock negativo (aviso en UI)
// CONFIRM → requiere confirmación explícita antes de facturar con stock insuficiente
// BLOCK → bloquea la emisión si el stock es insuficiente

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const StockControlLevelSchema = z.enum(["WARN", "CONFIRM", "BLOCK"]);

export type StockControlLevel = z.infer<typeof StockControlLevelSchema>;

// ─── Leer nivel actual ────────────────────────────────────────────────────────
export async function getStockControlLevelAction(
  companyId: string,
): Promise<ActionResult<{ level: StockControlLevel }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) {
      return { success: false, error: "No autorizado" };
    }

    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
      select: { stockControlLevel: true },
    });

    return {
      success: true,
      data: { level: (settings?.stockControlLevel ?? "WARN") as StockControlLevel },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error inesperado" };
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
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo propietarios y administradores pueden cambiar esta configuración" };
    }

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
          userId,
          ipAddress,
          userAgent,
          newValue: { stockControlLevel: parsed.data.level },
        },
      });
    });

    revalidatePath(`/company/${parsed.data.companyId}/settings`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Error inesperado" };
  }
}
