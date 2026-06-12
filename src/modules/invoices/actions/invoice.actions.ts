// src/modules/invoices/actions/invoice.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { withCompanyContext } from "@/lib/prisma-rls";
import { checkRateLimit, fiscalKey, limiters } from "@/lib/ratelimit";
import { InvoiceService } from "../services/InvoiceService";
import type { InvoiceFilters, InvoicePage } from "../services/InvoiceService";
import { getNextControlNumber } from "../services/InvoiceSequenceService";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { hasModuleAccess, moduleAccessError } from "@/lib/module-access";
import { CreateInvoiceSchema, InvoiceBookFilterSchema, CreateCreditDebitNoteSchema } from "../schemas/invoice.schema";
import { ExchangeRateService } from "@/modules/exchange-rates/services/ExchangeRateService";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";
import type { Currency } from "@prisma/client";
import { generateInvoiceBookPDF } from "../services/InvoiceBookPDFService";
import { generateInvoiceVoucherPDF } from "../services/InvoiceVoucherPDFService";
import { SeniatXMLService } from "../services/SeniatXMLService";
import { SeniatReportingService } from "../services/SeniatReportingService";
import { Decimal } from "decimal.js";
import qrcode from "qrcode";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
import { withSerializableRetry } from "@/lib/tx-helpers";

// ─── Crear factura ─────────────────────────────────────────────────────────────
export async function createInvoiceAction(input: unknown) {
  const parsed = CreateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "No autorizado" };

    const rl = await checkRateLimit(fiscalKey(parsed.data.companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false as const, error: rl.error };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false as const, error: "Empresa no encontrada o acceso denegado" };
    // ADR-025: verifica acceso base + grants granulares al módulo de Facturación
    if (!await hasModuleAccess(parsed.data.companyId, member.role, "invoicing")) {
      return { success: false as const, error: moduleAccessError("invoicing") };
    }

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

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
        return toActionError(e);
      }
    }

    // H-002 (Prov. 0071 Art. 14): SALE usa Serializable para correlativos (Z-1).
    // M2 (auditoría 2026-06): timeout 15s + retry P2034 previenen P2028 en cold start Neon.
    // PURCHASE: ReadCommitted sin correlativo — $transaction simple suficiente.
    const txBody = async (tx: Parameters<typeof withCompanyContext>[1]) =>
      withCompanyContext(parsed.data.companyId, tx, async (tx) => {
        let controlNumber = parsed.data.controlNumber;
        if (parsed.data.type === "SALE" && !controlNumber) {
          controlNumber = await getNextControlNumber(tx, parsed.data.companyId, "SALE");
        }

        const inv = await InvoiceService.create(
          { ...parsed.data, controlNumber, idempotencyKey: key, exchangeRateId: resolvedExchangeRateId },
          tx,
        );
        await tx.auditLog.create({
          data: {
            companyId: parsed.data.companyId,
            entityId: inv.id,
            entityName: "Invoice",
            action: "CREATE",
            userId,
            ipAddress,
            userAgent,
            newValue: {
              invoiceNumber: parsed.data.invoiceNumber,
              type: parsed.data.type,
              counterpartRif: parsed.data.counterpartRif,
              companyId: parsed.data.companyId,
            },
          },
        });
        return inv;
      });

    const invoice = parsed.data.type === "SALE"
      ? await withSerializableRetry(txBody)
      : await prisma.$transaction(txBody);

    // ADR-019 D-1.1a: publish a QStash POST-COMMIT (nunca dentro del $transaction).
    // publishForInvoice nunca lanza — si falla, la SeniatSubmission queda PENDING
    // y el poller /api/cron/seniat-outbox la rescata.
    if (parsed.data.type === "SALE") {
      await SeniatReportingService.publishForInvoice(invoice.id);
    }

    revalidatePath(`/company/${parsed.data.companyId}/invoices`);
    return {
      success: true as const,
      data: invoice.id,
      stockWarnings: (invoice.stockWarnings ?? []).length > 0 ? invoice.stockWarnings : undefined,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "STOCK_CONFIRM_REQUIRED") {
        const insufficient = (error as Error & { insufficient: Array<{ itemId: string; name: string; available: string; requested: string }> }).insufficient;
        return {
          success: false as const,
          error: "STOCK_CONFIRM_REQUIRED",
          insufficient,
        };
      }
      if (error.message.includes("P2002")) {
        // H-002 Z-1: P2002 en secuencia de Nº Control (upsert concurrente en ControlNumberSequence)
        if (parsed.data.type === "SALE" && error.message.toLowerCase().includes("controlnumber")) {
          return { success: false as const, error: "Error transitorio al generar Nº Control — intenta de nuevo." };
        }
        // Race condition: otro request con la misma clave ganó — buscar y retornar el existente
        if (parsed.data.idempotencyKey) {
          const existing = await prisma.invoice.findFirst({
            where: { idempotencyKey: parsed.data.idempotencyKey, companyId: parsed.data.companyId },
            select: { id: true },
          });
          if (existing) return { success: true as const, data: existing.id, stockWarnings: undefined };
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
    return toActionError(error);
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

    const rl = await checkRateLimit(userId, limiters.export);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de exportaciones excedido" };

    // Verificar que company pertenece al usuario
    const membership = await prisma.companyMember.findFirst({
      where: { companyId: params.companyId, userId },
      include: { company: true },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(membership.role, ROLES.ACCOUNTING)) return { success: false, error: "No autorizado" };

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
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
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

    const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Límite de solicitudes excedido" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
      select: { role: true },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(membership.role, ROLES.ACCOUNTING)) return { success: false, error: "No autorizado" };

    const invoice = await InvoiceService.getById(invoiceId, companyId);
    if (!invoice) return { success: false, error: "Factura no encontrada" };

    // Convertir taxLines a strings primero — usado tanto para QR como para PDF
    const mappedTaxLines = invoice.taxLines.map((l) => ({
      taxType: l.taxType,
      base: l.base.toFixed(2),
      rate: l.rate.toFixed(2),
      amount: l.amount.toFixed(2),
    }));
    const totalBase = mappedTaxLines.reduce(
      (acc, l) => acc.plus(l.base), new Decimal(0)
    ).toFixed(2);
    const totalIva = mappedTaxLines.reduce(
      (acc, l) => acc.plus(l.amount), new Decimal(0)
    ).toFixed(2);
    const montoTotal = new Decimal(totalBase).plus(totalIva).toFixed(2);

    const qrContent = SeniatXMLService.qrContent({
      companyRif: invoice.company.rif ?? "",
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber,
      date: invoice.date,
      currency: invoice.currency,
      montoTotal,
    });
    const qrCodeDataUrl = await qrcode.toDataURL(qrContent, { width: 120, margin: 1 });

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
      taxLines: mappedTaxLines,
      ivaRetentionAmount: invoice.ivaRetentionAmount.toFixed(2),
      ivaRetentionVoucher: invoice.ivaRetentionVoucher,
      islrRetentionAmount: invoice.islrRetentionAmount.toFixed(2),
      igtfBase: invoice.igtfBase.toFixed(2),
      igtfAmount: invoice.igtfAmount.toFixed(2),
      qrCodeDataUrl,
    });

    return { success: true, buffer: Array.from(pdfBuffer) };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Exportar XML SENIAT de una factura individual ────────────────────────────
/**
 * Genera el XML SENIAT (Providencia 0071) de una factura individual.
 * ADR-008: retorna el XML como string; el cliente hace Blob + download.
 * Rate limiting: limiters.fiscal (30/min).
 */
export async function exportInvoiceXMLAction(
  invoiceId: string,
  companyId: string,
): Promise<{ success: true; xml: string; filename: string } | { success: false; error: string }> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(fiscalKey(companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error ?? "Demasiadas solicitudes" };

    const membership = await prisma.companyMember.findFirst({
      where: { companyId, userId },
    });
    if (!membership) return { success: false, error: "Empresa no encontrada o acceso denegado" };

    const invoice = await InvoiceService.getById(invoiceId, companyId);
    if (!invoice) return { success: false, error: "Factura no encontrada" };

    const xml = SeniatXMLService.generate({
      companyName: invoice.company.name,
      companyRif: invoice.company.rif ?? "",
      companyAddress: invoice.company.address,
      invoiceType: invoice.type,
      docType: invoice.docType,
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber,
      date: invoice.date,
      currency: invoice.currency,
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

    const filename = SeniatXMLService.filename({
      invoiceType: invoice.type,
      invoiceNumber: invoice.invoiceNumber,
    });

    return { success: true, xml, filename };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Crear Nota de Crédito ─────────────────────────────────────────────────────
export async function createCreditNoteAction(input: unknown) {
  // Parse primero para disponer de companyId en el rate-limit composite (Z-1)
  const parsed = CreateCreditDebitNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "No autorizado" };

    const rl = await checkRateLimit(fiscalKey(parsed.data.companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false as const, error: rl.error ?? "Límite de solicitudes excedido" };

    const companyId = parsed.data.companyId;

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false as const, error: "No autorizado" };
    // ADR-025: verifica acceso base + grants granulares
    if (!await hasModuleAccess(companyId, member.role, "invoicing")) {
      return { success: false as const, error: moduleAccessError("invoicing") };
    }

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const nc = await InvoiceService.createCreditNote(companyId, parsed.data, userId, ipAddress, userAgent);

    // ADR-019 D-1.1a/D-1.1d: publish post-commit para NC de venta (nunca lanza)
    if (nc.type === "SALE") {
      await SeniatReportingService.publishForInvoice(nc.id);
    }

    revalidatePath(`/company/${companyId}/invoices`);
    return { success: true as const, data: nc };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        return { success: false as const, error: "Ya existe una nota con ese número para esta empresa" };
      }
      if (error.message.includes("P2003")) {
        return { success: false as const, error: "Datos de referencia inválidos" };
      }
      return { success: false as const, error: error.message };
    }
    return { success: false as const, error: "Error al registrar la nota de crédito" };
  }
}

// ─── Crear Nota de Débito ──────────────────────────────────────────────────────
export async function createDebitNoteAction(input: unknown) {
  // Parse primero para disponer de companyId en el rate-limit composite (Z-1)
  const parsed = CreateCreditDebitNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "No autorizado" };

    const rl = await checkRateLimit(fiscalKey(parsed.data.companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false as const, error: rl.error ?? "Límite de solicitudes excedido" };

    const companyId = parsed.data.companyId;

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!member) return { success: false as const, error: "No autorizado" };
    // ADR-025: verifica acceso base + grants granulares
    if (!await hasModuleAccess(companyId, member.role, "invoicing")) {
      return { success: false as const, error: moduleAccessError("invoicing") };
    }

    const h = await headers();
    const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const nd = await InvoiceService.createDebitNote(companyId, parsed.data, userId, ipAddress, userAgent);

    // ADR-019 D-1.1a/D-1.1d: publish post-commit para ND de venta (nunca lanza)
    if (nd.type === "SALE") {
      await SeniatReportingService.publishForInvoice(nd.id);
    }

    revalidatePath(`/company/${companyId}/invoices`);
    return { success: true as const, data: nd };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("P2002")) {
        return { success: false as const, error: "Ya existe una nota con ese número para esta empresa" };
      }
      if (error.message.includes("P2003")) {
        return { success: false as const, error: "Datos de referencia inválidos" };
      }
      return { success: false as const, error: error.message };
    }
    return { success: false as const, error: "Error al registrar la nota de débito" };
  }
}

// ─── Búsqueda de facturas para picker NC/ND ────────────────────────────────────

export type InvoicePickerItem = {
  id: string;
  invoiceNumber: string;
  counterpartName: string;
  counterpartRif: string | null;
  totalAmountVes: string | null;
  date: string; // ISO
};

/**
 * Búsqueda liviana de FACTURAs (docType === FACTURA) del mismo tipo (SALE/PURCHASE).
 * Devuelve hasta 10 resultados. Usado para el picker "Factura original" en NC/ND.
 */
export async function searchInvoicesForPickerAction(
  companyId: string,
  type: "SALE" | "PURCHASE",
  query: string,
): Promise<ActionResult<InvoicePickerItem[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type,
        docType: "FACTURA",
        deletedAt: null,
        ...(query.trim()
          ? {
              OR: [
                { invoiceNumber: { contains: query, mode: "insensitive" } },
                { counterpartName: { contains: query, mode: "insensitive" } },
                { counterpartRif: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { id: true, invoiceNumber: true, counterpartName: true, counterpartRif: true, totalAmountVes: true, date: true },
      orderBy: { date: "desc" },
      take: 10,
    });

    return {
      success: true,
      data: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        counterpartName: inv.counterpartName,
        counterpartRif: inv.counterpartRif ?? null,
        totalAmountVes: inv.totalAmountVes ? inv.totalAmountVes.toString() : null,
        date: inv.date.toISOString().slice(0, 10),
      })),
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al buscar facturas" };
  }
}

// ─── Notas de crédito/débito vinculadas a una factura ──────────────────────────

export type CreditDebitNoteItem = {
  id: string;
  invoiceNumber: string;
  docType: string; // "NOTA_CREDITO" | "NOTA_DEBITO"
  date: string; // ISO
  counterpartName: string;
  totalAmountVes: string | null;
  paymentStatus: string;
};

export async function getCreditDebitNotesAction(
  companyId: string,
  invoiceId: string,
): Promise<ActionResult<CreditDebitNoteItem[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  if (!canAccess(member.role, ROLES.WRITERS)) return { success: false, error: "No autorizado" };

  try {
    const notes = await prisma.invoice.findMany({
      where: { companyId, relatedInvoiceId: invoiceId, deletedAt: null },
      select: {
        id: true,
        invoiceNumber: true,
        docType: true,
        date: true,
        counterpartName: true,
        totalAmountVes: true,
        paymentStatus: true,
      },
      orderBy: { date: "asc" },
    });

    return {
      success: true,
      data: notes.map((n) => ({
        id: n.id,
        invoiceNumber: n.invoiceNumber,
        docType: n.docType,
        date: n.date.toISOString().slice(0, 10),
        counterpartName: n.counterpartName,
        totalAmountVes: n.totalAmountVes ? n.totalAmountVes.toString() : null,
        paymentStatus: n.paymentStatus,
      })),
    };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener notas" };
  }
}

// ─── Obtener libro de compras o ventas ─────────────────────────────────────────
export async function getInvoiceBookAction(input: unknown) {
  const parsed = InvoiceBookFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0].message };
  }

  try {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "No autorizado" };

    const rl = await checkRateLimit(fiscalKey(parsed.data.companyId, userId), limiters.fiscal);
    if (!rl.allowed) return { success: false as const, error: rl.error ?? "Límite de solicitudes excedido" };

    const member = await prisma.companyMember.findFirst({
      where: { companyId: parsed.data.companyId, userId },
      select: { role: true },
    });
    if (!member) return { success: false as const, error: "Empresa no encontrada o acceso denegado" };
    if (!canAccess(member.role, ROLES.ACCOUNTING)) return { success: false as const, error: "No autorizado" };

    const result = await InvoiceService.getBook(parsed.data);
    return { success: true as const, data: result };
  } catch (error) {
    return toActionError(error);
  }
}
