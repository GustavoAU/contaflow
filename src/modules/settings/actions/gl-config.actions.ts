"use server";

// ADR-026: Causación automática de facturas al Libro Mayor
// Estas actions gestionan la configuración de las 6 cuentas GL en CompanySettings
// y el posting retroactivo de facturas que quedaron sin asiento.

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { InvoiceGLPostingService } from "@/modules/invoices/services/InvoiceGLPostingService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

const SaveGLConfigSchema = z.object({
  companyId: z.string().min(1),
  arAccountId: z.string().nullable(),
  apAccountId: z.string().nullable(),
  salesAccountId: z.string().nullable(),
  purchaseExpenseAccountId: z.string().nullable(),
  inventoryAccountId: z.string().nullable(),
  ivaDFAccountId: z.string().nullable(),
  ivaCFAccountId: z.string().nullable(),
  fxGainAccountId: z.string().nullable(),
  fxLossAccountId: z.string().nullable(),
});

// ─── Leer config GL actual ─────────────────────────────────────────────────────
export async function getGLConfigAction(companyId: string): Promise<
  ActionResult<{
    arAccountId: string | null;
    apAccountId: string | null;
    salesAccountId: string | null;
    purchaseExpenseAccountId: string | null;
    inventoryAccountId: string | null;
    ivaDFAccountId: string | null;
    ivaCFAccountId: string | null;
    fxGainAccountId: string | null;
    fxLossAccountId: string | null;
    unbookedCount: number;
  }>
> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "No autorizado" };

    const [settings, unbookedCount] = await Promise.all([
      prisma.companySettings.findUnique({
        where: { companyId },
        select: {
          arAccountId: true,
          apAccountId: true,
          salesAccountId: true,
          purchaseExpenseAccountId: true,
          inventoryAccountId: true,
          ivaDFAccountId: true,
          ivaCFAccountId: true,
          fxGainAccountId: true,
          fxLossAccountId: true,
        },
      }),
      prisma.invoice.count({
        where: {
          companyId,
          transactionId: null,
          deletedAt: null,
          type: { in: ["SALE", "PURCHASE"] },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        arAccountId: settings?.arAccountId ?? null,
        apAccountId: settings?.apAccountId ?? null,
        salesAccountId: settings?.salesAccountId ?? null,
        purchaseExpenseAccountId: settings?.purchaseExpenseAccountId ?? null,
        inventoryAccountId: settings?.inventoryAccountId ?? null,
        ivaDFAccountId: settings?.ivaDFAccountId ?? null,
        ivaCFAccountId: settings?.ivaCFAccountId ?? null,
        fxGainAccountId: settings?.fxGainAccountId ?? null,
        fxLossAccountId: settings?.fxLossAccountId ?? null,
        unbookedCount,
      },
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener la configuración contable" };
  }
}

// ─── Guardar config GL ─────────────────────────────────────────────────────────
export async function saveGLConfigAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  const parsed = SaveGLConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo el Administrador puede modificar la configuración contable." };
    }

    const hdrs = await headers();
    const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? null;
    const userAgent = hdrs.get("user-agent") ?? null;

    const { companyId, ...fields } = parsed.data;

    await prisma.$transaction(async (tx) => {
      await tx.companySettings.upsert({
        where: { companyId },
        update: fields,
        create: { companyId, ...fields },
      });

      await tx.auditLog.create({
        data: {
          companyId,
          entityId: companyId,
          entityName: "CompanySettings",
          action: "UPDATE",
          userId,
          ipAddress,
          userAgent,
          newValue: fields,
        },
      });
    });

    revalidatePath(`/company/${companyId}/settings`);
    return { success: true, data: { saved: true } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al guardar la configuración contable" };
  }
}

// ─── Causar facturas sin asiento (retroactivo) ─────────────────────────────────
// Busca facturas con transactionId = null y las postea al Libro Mayor.
// Solo funciona si la config GL está completa para el tipo de factura.
export async function postUnbookedInvoicesAction(
  companyId: string
): Promise<ActionResult<{ posted: number; skipped: number }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member || !canAccess(member.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo el Administrador puede ejecutar la causación retroactiva." };
    }

    const hdrs = await headers();
    const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? null;
    const userAgent = hdrs.get("user-agent") ?? null;

    const settings = await prisma.companySettings.findUnique({
      where: { companyId },
      select: {
        arAccountId: true,
        apAccountId: true,
        salesAccountId: true,
        purchaseExpenseAccountId: true,
        inventoryAccountId: true,
        ivaDFAccountId: true,
        ivaCFAccountId: true,
      },
    });

    if (!settings) {
      return { success: false, error: "Configure primero las cuentas contables antes de causar." };
    }

    // Cap at 200 to prevent runaway transactions on very large datasets
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        transactionId: null,
        deletedAt: null,
        type: { in: ["SALE", "PURCHASE"] },
      },
      include: { taxLines: true },
      orderBy: { date: "asc" },
      take: 200,
    });

    let posted = 0;
    let skipped = 0;

    for (const inv of invoices) {
      const type = inv.type as "SALE" | "PURCHASE";
      if (!InvoiceGLPostingService.canPost(type, settings)) {
        skipped++;
        continue;
      }
      try {
        await prisma.$transaction(async (db) => {
          await InvoiceGLPostingService.postInvoice(
            {
              id: inv.id,
              type,
              invoiceNumber: inv.invoiceNumber,
              counterpartName: inv.counterpartName,
              date: inv.date,
              periodId: inv.periodId ?? null,
              totalAmountVes: inv.totalAmountVes,
              taxLines: inv.taxLines,
            },
            settings,
            companyId,
            userId,
            db
          );

          await db.auditLog.create({
            data: {
              companyId,
              entityId: inv.id,
              entityName: "Invoice",
              action: "GL_POST",
              userId,
              ipAddress,
              userAgent,
              newValue: { invoiceNumber: inv.invoiceNumber, type },
            },
          });
        });
        posted++;
      } catch {
        skipped++;
      }
    }

    revalidatePath(`/company/${companyId}/settings`);
    revalidatePath(`/company/${companyId}/reports`);
    return { success: true, data: { posted, skipped } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al causar las facturas" };
  }
}
