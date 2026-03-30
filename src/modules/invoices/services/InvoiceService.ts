// src/modules/invoices/services/InvoiceService.ts
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CreateInvoiceInput, InvoiceBookFilter } from "../schemas/invoice.schema";

// ─── Tipos de retorno ──────────────────────────────────────────────────────────
export type InvoiceTaxLineSerialized = {
  id: string;
  taxType: string;
  base: string;
  rate: string;
  amount: string;
};

export type InvoiceBookRow = {
  id: string;
  date: Date;
  invoiceNumber: string;
  controlNumber: string | null;
  relatedDocNumber: string | null;
  importFormNumber: string | null;
  reportZStart: string | null;
  reportZEnd: string | null;
  docType: string;
  taxCategory: string;
  counterpartName: string;
  counterpartRif: string;
  ivaRetentionAmount: string;
  ivaRetentionVoucher: string | null;
  ivaRetentionDate: Date | null;
  islrRetentionAmount: string;
  igtfBase: string;
  igtfAmount: string;
  taxLines: InvoiceTaxLineSerialized[];
};

export type InvoiceBookSummary = {
  totalBaseGeneral: string;
  totalIvaGeneral: string;
  totalBaseReduced: string;
  totalIvaReduced: string;
  totalBaseAdditional: string;
  totalIvaAdditional: string;
  totalExempt: string;
  totalIvaRetention: string;
  totalIslrRetention: string;
  totalIgtf: string;
};

export type InvoiceBookResult = {
  rows: InvoiceBookRow[];
  summary: InvoiceBookSummary;
};

export class InvoiceService {
  // ─── Crear factura ───────────────────────────────────────────────────────────
  static async create(input: CreateInvoiceInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;
    const invoice = await db.invoice.create({
      data: {
        companyId: input.companyId,
        type: input.type,
        docType: input.docType,
        taxCategory: input.taxCategory,
        invoiceNumber: input.invoiceNumber,
        controlNumber: input.controlNumber,
        relatedDocNumber: input.relatedDocNumber,
        importFormNumber: input.importFormNumber,
        reportZStart: input.reportZStart,
        reportZEnd: input.reportZEnd,
        date: input.date,
        counterpartName: input.counterpartName,
        counterpartRif: input.counterpartRif,
        ivaRetentionAmount: new Decimal(input.ivaRetentionAmount),
        ivaRetentionVoucher: input.ivaRetentionVoucher,
        ivaRetentionDate: input.ivaRetentionDate,
        islrRetentionAmount: new Decimal(input.islrRetentionAmount),
        igtfBase: new Decimal(input.igtfBase),
        igtfAmount: new Decimal(input.igtfAmount),
        transactionId: input.transactionId,
        periodId: input.periodId,
        createdBy: input.createdBy,
        idempotencyKey: input.idempotencyKey,
        taxLines: {
          create: input.taxLines.map((line) => ({
            taxType: line.taxType,
            base: new Decimal(line.base),
            rate: new Decimal(line.rate),
            amount: new Decimal(line.amount),
          })),
        },
      },
      include: { taxLines: true },
    });
    return invoice;
  }

  // ─── Obtener factura por ID ──────────────────────────────────────────────────
  static async getById(invoiceId: string, companyId: string) {
    return prisma.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      include: { taxLines: true, company: true },
    });
  }

  // ─── Obtener libro ───────────────────────────────────────────────────────────
  static async getBook(filter: InvoiceBookFilter): Promise<InvoiceBookResult> {
    const startDate = new Date(filter.year, filter.month - 1, 1);
    const endDate = new Date(filter.year, filter.month, 1);

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId: filter.companyId,
        type: filter.type,
        date: { gte: startDate, lt: endDate },
        deletedAt: null,
      },
      include: { taxLines: true },
      orderBy: { date: "asc" },
    });

    // ─── Serializar ──────────────────────────────────────────────────────────
    const rows: InvoiceBookRow[] = invoices.map((inv) => ({
      id: inv.id,
      date: inv.date,
      invoiceNumber: inv.invoiceNumber,
      controlNumber: inv.controlNumber,
      relatedDocNumber: inv.relatedDocNumber,
      importFormNumber: inv.importFormNumber,
      reportZStart: inv.reportZStart,
      reportZEnd: inv.reportZEnd,
      docType: inv.docType,
      taxCategory: inv.taxCategory,
      counterpartName: inv.counterpartName,
      counterpartRif: inv.counterpartRif,
      ivaRetentionAmount: inv.ivaRetentionAmount.toFixed(2),
      ivaRetentionVoucher: inv.ivaRetentionVoucher,
      ivaRetentionDate: inv.ivaRetentionDate,
      islrRetentionAmount: inv.islrRetentionAmount.toFixed(2),
      igtfBase: inv.igtfBase.toFixed(2),
      igtfAmount: inv.igtfAmount.toFixed(2),
      taxLines: inv.taxLines.map((line) => ({
        id: line.id,
        taxType: line.taxType,
        base: line.base.toFixed(2),
        rate: line.rate.toFixed(2),
        amount: line.amount.toFixed(2),
      })),
    }));

    // ─── Sumar taxLines por tipo ─────────────────────────────────────────────
    const sumTaxLines = (type: string) =>
      invoices
        .flatMap((inv) => inv.taxLines)
        .filter((line) => line.taxType === type)
        .reduce((acc, line) => acc.plus(line.amount), new Decimal(0))
        .toFixed(2);

    const sumTaxBases = (type: string) =>
      invoices
        .flatMap((inv) => inv.taxLines)
        .filter((line) => line.taxType === type)
        .reduce((acc, line) => acc.plus(line.base), new Decimal(0))
        .toFixed(2);

    const sumField = (field: "ivaRetentionAmount" | "islrRetentionAmount" | "igtfAmount") =>
      invoices.reduce((acc, inv) => acc.plus(inv[field] as Decimal), new Decimal(0)).toFixed(2);

    const summary: InvoiceBookSummary = {
      totalBaseGeneral: sumTaxBases("IVA_GENERAL"),
      totalIvaGeneral: sumTaxLines("IVA_GENERAL"),
      totalBaseReduced: sumTaxBases("IVA_REDUCIDO"),
      totalIvaReduced: sumTaxLines("IVA_REDUCIDO"),
      totalBaseAdditional: sumTaxBases("IVA_ADICIONAL"),
      totalIvaAdditional: sumTaxLines("IVA_ADICIONAL"),
      totalExempt: sumTaxBases("EXENTO"),
      totalIvaRetention: sumField("ivaRetentionAmount"),
      totalIslrRetention: sumField("islrRetentionAmount"),
      totalIgtf: sumField("igtfAmount"),
    };

    return { rows, summary };
  }
}
