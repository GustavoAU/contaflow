// src/modules/documents/services/DocumentService.ts
// Q3-1: Gestión Documental — agrega facturas + retenciones en una vista unificada.
// No importa de InvoiceService ni RetentionService — consulta Prisma directamente
// para mantener el bounded context limpio (ADR DDD).

import prisma from "@/lib/prisma";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DocumentType =
  | "FACTURA_VENTA"
  | "FACTURA_COMPRA"
  | "RETENCION_IVA"
  | "RETENCION_ISLR"
  | "RETENCION_AMBAS";

export type DocumentRow = {
  id: string;
  documentType: DocumentType;
  number: string;
  counterpart: string;
  date: Date;
  amountVes: string;
  currency: string;
};

export type DocumentFilters = {
  docType?: string;    // "" | "FACTURA_VENTA" | "FACTURA_COMPRA" | "RETENCION_IVA" | "RETENCION_ISLR"
  dateFrom?: string;   // YYYY-MM-DD
  dateTo?: string;     // YYYY-MM-DD
  search?: string;     // número o contraparte
};

const PAGE_SIZE = 50;

// ─── DocumentService ──────────────────────────────────────────────────────────

export class DocumentService {
  /**
   * Lista documentos (facturas + retenciones) paginados para la vista unificada.
   * El resultado se ordena por fecha descendente.
   * ADR-004: companyId guard en todos los queries.
   */
  static async list(
    companyId: string,
    filters: DocumentFilters,
    page = 1,
  ): Promise<{ items: DocumentRow[]; total: number }> {
    const offset = (page - 1) * PAGE_SIZE;

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00Z") : undefined;
    const dateTo   = filters.dateTo   ? new Date(filters.dateTo   + "T23:59:59Z") : undefined;
    const search   = filters.search?.trim();

    // ── Facturas ──────────────────────────────────────────────────────────────
    const wantInvoices =
      !filters.docType ||
      filters.docType === "FACTURA_VENTA" ||
      filters.docType === "FACTURA_COMPRA";

    let invoiceRows: DocumentRow[] = [];

    if (wantInvoices) {
      const typeFilter =
        filters.docType === "FACTURA_VENTA"
          ? ("SALE" as const)
          : filters.docType === "FACTURA_COMPRA"
            ? ("PURCHASE" as const)
            : undefined;

      const invoices = await prisma.invoice.findMany({
        where: {
          companyId,
          deletedAt: null,
          type: typeFilter ? { equals: typeFilter } : { in: ["SALE", "PURCHASE"] },
          ...(dateFrom || dateTo
            ? { date: { ...(dateFrom && { gte: dateFrom }), ...(dateTo && { lte: dateTo }) } }
            : {}),
          ...(search
            ? {
                OR: [
                  { invoiceNumber: { contains: search, mode: "insensitive" } },
                  { counterpartName: { contains: search, mode: "insensitive" } },
                  { counterpartRif: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          invoiceNumber: true,
          counterpartName: true,
          date: true,
          totalAmountVes: true,
          currency: true,
        },
        orderBy: { date: "desc" },
        take: PAGE_SIZE * 5, // buffer para merge
      });

      invoiceRows = invoices.map((inv) => ({
        id: inv.id,
        documentType: (inv.type === "SALE" ? "FACTURA_VENTA" : "FACTURA_COMPRA") as DocumentType,
        number: inv.invoiceNumber,
        counterpart: inv.counterpartName,
        date: inv.date,
        amountVes: inv.totalAmountVes?.toString() ?? "0",
        currency: inv.currency,
      }));
    }

    // ── Retenciones ───────────────────────────────────────────────────────────
    const wantRetentions =
      !filters.docType ||
      filters.docType === "RETENCION_IVA" ||
      filters.docType === "RETENCION_ISLR" ||
      filters.docType === "RETENCION_AMBAS";

    let retentionRows: DocumentRow[] = [];

    if (wantRetentions) {
      const retTypeFilter =
        filters.docType === "RETENCION_IVA"
          ? "IVA"
          : filters.docType === "RETENCION_ISLR"
            ? "ISLR"
            : filters.docType === "RETENCION_AMBAS"
              ? "AMBAS"
              : undefined;

      const retentions = await prisma.retencion.findMany({
        where: {
          companyId,
          deletedAt: null,
          ...(retTypeFilter ? { type: retTypeFilter } : {}),
          ...(dateFrom || dateTo
            ? { invoiceDate: { ...(dateFrom && { gte: dateFrom }), ...(dateTo && { lte: dateTo }) } }
            : {}),
          ...(search
            ? {
                OR: [
                  { voucherNumber: { contains: search, mode: "insensitive" } },
                  { providerName: { contains: search, mode: "insensitive" } },
                  { providerRif: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          voucherNumber: true,
          providerName: true,
          invoiceDate: true,
          totalRetention: true,
        },
        orderBy: { invoiceDate: "desc" },
        take: PAGE_SIZE * 5,
      });

      retentionRows = retentions.map((ret) => ({
        id: ret.id,
        documentType: (
          ret.type === "IVA" ? "RETENCION_IVA"
          : ret.type === "ISLR" ? "RETENCION_ISLR"
          : "RETENCION_AMBAS"
        ) as DocumentType,
        number: ret.voucherNumber ?? ret.id.slice(-8).toUpperCase(),
        counterpart: ret.providerName,
        date: ret.invoiceDate,
        amountVes: ret.totalRetention.toString(),
        currency: "VES",
      }));
    }

    // ── Merge + sort + paginate ───────────────────────────────────────────────
    const all = [...invoiceRows, ...retentionRows].sort(
      (a, b) => b.date.getTime() - a.date.getTime(),
    );

    return {
      total: all.length,
      items: all.slice(offset, offset + PAGE_SIZE),
    };
  }

  /**
   * Genera el buffer PDF de una factura SIN autenticación Clerk.
   * La autorización queda garantizada por el token JWT (companyId guard obligatorio).
   * Sólo para uso interno del endpoint /api/doc/[token].
   */
  static async generateInvoicePDFBuffer(
    invoiceId: string,
    companyId: string,
  ): Promise<Buffer | null> {
    // Import lazy para evitar que @react-pdf/renderer se cargue en todos los módulos
    const [
      { generateInvoiceVoucherPDF },
      { SeniatXMLService },
      { default: qrcode },
    ] = await Promise.all([
      import("@/modules/invoices/services/InvoiceVoucherPDFService"),
      import("@/modules/invoices/services/SeniatXMLService"),
      import("qrcode"),
    ]);

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null }, // ADR-004 guard
      include: {
        company: { select: { name: true, rif: true, address: true } },
        taxLines: true,
      },
    });
    if (!invoice) return null;

    const { Decimal } = await import("decimal.js");

    const mappedTaxLines = invoice.taxLines.map((l) => ({
      taxType: l.taxType,
      base: new Decimal(l.base.toString()).toFixed(2),
      rate: new Decimal(l.rate.toString()).toFixed(2),
      amount: new Decimal(l.amount.toString()).toFixed(2),
    }));
    const totalBase = mappedTaxLines
      .reduce((acc, l) => acc.plus(l.base), new Decimal(0))
      .toFixed(2);
    const totalIva = mappedTaxLines
      .reduce((acc, l) => acc.plus(l.amount), new Decimal(0))
      .toFixed(2);
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

    return generateInvoiceVoucherPDF({
      companyName: invoice.company.name,
      companyRif: invoice.company.rif ?? "",
      companyAddress: invoice.company.address ?? undefined,
      invoiceNumber: invoice.invoiceNumber,
      controlNumber: invoice.controlNumber ?? undefined,
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
  }

  /**
   * Genera el buffer PDF de una retención SIN autenticación Clerk.
   */
  static async generateRetentionPDFBuffer(
    retentionId: string,
    companyId: string,
  ): Promise<Buffer | null> {
    const { generateRetentionVoucherPDF } = await import(
      "@/modules/retentions/services/RetentionVoucherPDFService"
    );

    const retention = await prisma.retencion.findFirst({
      where: { id: retentionId, companyId, deletedAt: null }, // ADR-004 guard
      include: { company: { select: { name: true, rif: true, address: true } } },
    });
    if (!retention) return null;

    const issueDate = retention.createdAt;
    const monthLabel = issueDate.toLocaleString("es-VE", {
      month: "long",
      year: "numeric",
    });
    const retentionType = retention.type as "IVA" | "ISLR" | "AMBAS";
    const retentionRate =
      retentionType === "ISLR"
        ? Number(retention.islrRetentionPct ?? 0)
        : retentionType === "IVA"
          ? Number(retention.ivaRetentionPct)
          : undefined;

    return generateRetentionVoucherPDF({
      companyName: retention.company.name,
      companyRif: retention.company.rif ?? "",
      companyAddress: retention.company.address ?? undefined,
      voucherNumber: retention.voucherNumber ?? retention.id,
      issueDate,
      providerName: retention.providerName,
      providerRif: retention.providerRif,
      periodLabel: monthLabel,
      retentionType,
      retentionRate,
      invoiceNumber: retention.invoiceNumber,
      invoiceDate: retention.invoiceDate,
      invoiceAmount: retention.invoiceAmount,
      taxableBase: retention.taxBase,
      retainedAmount: retention.totalRetention,
      ivaRetention: retention.ivaRetention,
      ivaRetentionPct: Number(retention.ivaRetentionPct),
      islrAmount: retention.islrAmount ?? undefined,
      islrRetentionPct: retention.islrRetentionPct
        ? Number(retention.islrRetentionPct)
        : undefined,
    });
  }
}
