"use server";

// ADR-026: Causación automática de facturas al Libro Mayor
// Estas actions gestionan la configuración de las 6 cuentas GL en CompanySettings
// y el posting retroactivo de facturas que quedaron sin asiento.

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { limiters } from "@/lib/ratelimit";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { InvoiceGLPostingService } from "@/modules/invoices/services/InvoiceGLPostingService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

const SaveGLConfigSchema = z.object({
  companyId: z.string().min(1),
  arAccountId: z.string().nullable(),
  apAccountId: z.string().nullable(),
  salesAccountId: z.string().nullable(),
  purchaseExpenseAccountId: z.string().nullable(),
  inventoryAccountId: z.string().nullable(),
  ivaDFAccountId: z.string().nullable(),
  ivaCFAccountId: z.string().nullable(),
  ivaRetentionPayableAccountId: z.string().nullable(),        // GAP-03
  ivaRetentionReceivableAccountId: z.string().nullable(),     // Riesgo-6 audit: IVA ret x cobrar
  fxGainAccountId: z.string().nullable(),
  fxLossAccountId: z.string().nullable(),
  igtfPayableAccountId: z.string().nullable(), // ADR-030 — IGTF por pagar (PASIVO 2115)
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
    ivaRetentionPayableAccountId: string | null;    // GAP-03
    ivaRetentionReceivableAccountId: string | null; // Riesgo-6
    fxGainAccountId: string | null;
    fxLossAccountId: string | null;
    igtfPayableAccountId: string | null; // ADR-030
    unbookedCount: number;
  }>
> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: "MEMBER_ANY" });
    if (!ctx.ok) return ctx.error;

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
          ivaRetentionPayableAccountId: true,    // GAP-03
          ivaRetentionReceivableAccountId: true, // Riesgo-6
          fxGainAccountId: true,
          fxLossAccountId: true,
          igtfPayableAccountId: true, // ADR-030
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
        ivaRetentionPayableAccountId: settings?.ivaRetentionPayableAccountId ?? null,    // GAP-03
        ivaRetentionReceivableAccountId: settings?.ivaRetentionReceivableAccountId ?? null, // Riesgo-6
        fxGainAccountId: settings?.fxGainAccountId ?? null,
        fxLossAccountId: settings?.fxLossAccountId ?? null,
        igtfPayableAccountId: settings?.igtfPayableAccountId ?? null, // ADR-030
        unbookedCount,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Guardar config GL ─────────────────────────────────────────────────────────
export async function saveGLConfigAction(input: unknown): Promise<ActionResult<{ saved: true }>> {
  const parsed = SaveGLConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const ctx = await requireCompanyAction(parsed.data.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

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
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          newValue: fields,
        },
      });
    });

    revalidatePath(`/company/${companyId}/settings`);
    return { success: true, data: { saved: true } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Causar facturas sin asiento (retroactivo) ─────────────────────────────────
// Busca facturas con transactionId = null y las postea al Libro Mayor.
// Solo funciona si la config GL está completa para el tipo de factura.
export async function postUnbookedInvoicesAction(
  companyId: string
): Promise<ActionResult<{ posted: number; skipped: number }>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;
    const { userId, ipAddress, userAgent } = ctx;

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
        ivaRetentionPayableAccountId: true, // GAP-03
        igtfPayableAccountId: true,         // H-6 — ADR-030
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
    return toActionError(error);
  }
}
