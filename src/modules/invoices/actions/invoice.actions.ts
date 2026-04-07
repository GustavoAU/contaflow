// src/modules/invoices/actions/invoice.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { InvoiceService } from "../services/InvoiceService";
import type { InvoiceFilters, InvoicePage } from "../services/InvoiceService";
import { CreateInvoiceSchema, InvoiceBookFilterSchema } from "../schemas/invoice.schema";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import type { Currency } from "@prisma/client";
import { generateInvoiceBookPDF } from "../services/InvoiceBookPDFService";
import { generateInvoiceVoucherPDF } from "../services/InvoiceVoucherPDFService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear factura ─────────────────────────────────────────────────────────────
export async function createInvoiceAction(input: unknown) {
  const parsed = CreateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false as const, error: rl.error };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false as const, error: "Empresa no encontrada o acceso denegado" };
    if (member.role === "VIEWER") return { success: false as const, error: "No autorizado" };

    const key = parsed.data.idempotencyKey ?? crypto.randomUUID();

    // Idempotencia: si ya existe una factura con esta clave, retornar la existente
    if (parsed.data.idempotencyKey) {
      const existing = await prisma.invoice.findFirst({
        where: { idempotencyKey: key, companyId: parsed.data.companyId },
        select: { id: true },
      });
      if (existing) {
        return { success: true as const, data: existing.id };
      }
    }

    // Fase 15: Guard — no permitir facturas en ejercicios cerrados
    const invoiceYear = parsed.data.date.getFullYear();
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(
      parsed.data.companyId,
      invoiceYear
    );
    if (yearClosed) {
      return {
        success: false as const,
        error: `El ejercicio económico ${invoiceYear} está cerrado. No se pueden registrar facturas en ejercicios cerrados.`,
      };
    }

    // Multimoneda: validar que existe tasa BCV para la fecha si currency !== VES
    let resolvedExchangeRateId = parsed.data.exchangeRateId;
    if (parsed.data.currency !== "VES") {
      const dateOnly = new Date(
        Date.UTC(
          parsed.data.date.getFullYear(),
          parsed.data.date.getMonth(),
          parsed.data.date.getDate(),
        ),
      );
      try {
        const rateRecord = await ExchangeRateService.getRateForDate(
          parsed.data.companyId,
          parsed.data.currency as Currency,
          dateOnly,
        );
        resolvedExchangeRateId = rateRecord.id;
      } catch (e) {
        return {
          success: false as const,
          error: e instanceof Error ? e.message : "Tasa de cambio no encontrada",
        };
      }
    }

    const invoice = await prisma.$transaction(async (tx) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) => {
        const inv = await InvoiceService.create(
          { ...parsed.data, idempotencyKey: key, exchangeRateId: resolvedExchangeRateId },
          tx,
        );
        await tx.auditLog.create({
          data: {
            entityId: inv.id,
            entityName: "Invoice",
            action: "CREATE",
            userId,
            newValue: {
              invoiceNumber: parsed.data.invoiceNumber,
              type: parsed.data.type,
              counterpartRif: parsed.data.counterpartRif,
              companyId: parsed.data.companyId,
            },
          },
        });
        return inv;
      })
    );

    revalidatePath(`/company/${parsed.data.companyId}/invoices`);
    return { success: true as const, data: invoice.id };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        // Race condition: otro request con la misma clave ganó — buscar y retornar el existente
        if (parsed.data.idempotencyKey) {
          const existing = await prisma.invoice.findFirst({
            where: { idempotencyKey: parsed.data.idempotencyKey, companyId: parsed.data.companyId },
            select: { id: true },
          });
          if (existing) return { success: true as const, data: existing.id };
        }
        return {
          success: false as const,
          error: "Ya existe una factura con ese número para esta empresa",
        };
      }
      if (error.message.includes("P2003")) {
        return {
          success: false as const,
          error: "Datos de referencia inválidos (empresa o período no existe)",
        };
      }
    }
    return { success: false as const, error: "Error al registrar la factura" };
  }
}

// ─── Listado paginado cursor-based ─────────────────────────────────────────────
export async function getInvoicesPaginatedAction(
  companyId: string,
  filters: InvoiceFilters = {},
  cursor?: string,
  limit?: number
): Promise<ActionResult<InvoicePage>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const page = await InvoiceService.getInvoicesPaginated(companyId, filters, cursor, limit);
    return { success: true, data: page };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener las facturas" };
  }
}

// ─── Exportar libro de compras/ventas en PDF ───────────────────────────────────
export async function exportInvoiceBookPDFAction(params: {
  companyId: string
  type: "SALE" | "PURCHASE"
  year: number
  month: number
}): Promise<{ success: true; buffer: number[] } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    // Verificar que company pertenece al usuario
    const membership = await prisma.companyMember.findFirst({
      where: { companyId: params.companyId, userId },
      include: { company: true },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const { rows, summary } = await InvoiceService.getBook({
      companyId: params.companyId,
      type: params.type,
      year: params.year,
      month: params.month,
    });

    const monthLabel = new Date(params.year, params.month - 1, 1).toLocaleString("es-VE", {
      month: "long",
      year: "numeric",
    });

    const pdfBuffer = await generateInvoiceBookPDF({
      companyId: params.companyId,
      companyName: membership.company.name,
      companyRif: membership.company.rif ?? "",
      periodId: `${params.year}-${String(params.month).padStart(2, "0")}`,
      periodLabel: monthLabel,
      invoiceType: params.type,
      invoices: rows,
      summary,
    });

    return { success: true, buffer: Array.from(pdfBuffer) };
  } catch {
    return { success: false, error: "Error al generar PDF" };
  }
}

// ─── Exportar comprobante PDF de factura individual ────────────────────────────
export async function exportInvoiceVoucherPDFAction(
  invoiceId: string,
  companyId: string,
): Promise<{ success: true; buffer: number[] } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const invoice = await InvoiceService.getById(invoiceId, companyId);
    if (!invoice) return { success: false, error: "Factura no encontrada" };

    const pdfBuffer = await generateInvoiceVoucherPDF({
      companyName: invoice.company.name,
      companyRif: invoice.company.rif ?? "",
      companyAddress: invoice.company.address,
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber,
      invoiceType: invoice.type,
      docType: invoice.docType,
      date: invoice.date,
      counterpartName: invoice.counterpartName,
      counterpartRif: invoice.counterpartRif,
      taxLines: invoice.taxLines.map((l) => ({
        taxType: l.taxType,
        base: l.base.toFixed(2),
        rate: l.rate.toFixed(2),
        amount: l.amount.toFixed(2),
      })),
      ivaRetentionAmount: invoice.ivaRetentionAmount.toFixed(2),
      ivaRetentionVoucher: invoice.ivaRetentionVoucher,
      islrRetentionAmount: invoice.islrRetentionAmount.toFixed(2),
      igtfBase: invoice.igtfBase.toFixed(2),
      igtfAmount: invoice.igtfAmount.toFixed(2),
    });

    return { success: true, buffer: Array.from(pdfBuffer) };
  } catch {
    return { success: false, error: "Error al generar PDF de factura" };
  }
}

// ─── Obtener libro de compras o ventas ─────────────────────────────────────────
export async function getInvoiceBookAction(input: unknown) {
  const parsed = InvoiceBookFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const result = await InvoiceService.getBook(parsed.data);
    return { success: true as const, data: result };
  } catch {
    return { success: false as const, error: "Error al obtener el libro" };
  }
}
