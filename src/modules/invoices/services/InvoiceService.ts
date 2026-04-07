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
  currency: string;
  exchangeRateId: string | null;
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

// ─── Paginación cursor-based ──────────────────────────────────────────────────

export type InvoiceFilters = {
  type?: "SALE" | "PURCHASE";
  dateFrom?: Date;
  dateTo?: Date;
  paymentStatus?: "UNPAID" | "PARTIAL" | "PAID" | "VOIDED";
  search?: string; // busca en invoiceNumber, counterpartName, counterpartRif
};

export type InvoiceRow = {
  id: string;
  date: Date;
  invoiceNumber: string;
  controlNumber: string | null;
  docType: string;
  taxCategory: string;
  type: string;
  counterpartName: string;
  counterpartRif: string;
  currency: string;
  totalAmountVes: string | null;
  pendingAmount: string | null;
  paymentStatus: string;
  ivaRetentionAmount: string;
  islrRetentionAmount: string;
  igtfAmount: string;
  dueDate: Date | null;
};

export type InvoicePage = {
  data: InvoiceRow[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

// ─── Parámetros e interfaz para libro paginado por período ────────────────────

// Parámetros de paginación para el libro de facturas filtrado por periodId.
// cursor y limit son opcionales para retrocompatibilidad.
export type InvoiceBookParams = {
  companyId: string;
  periodId: string;
  invoiceType: "SALE" | "PURCHASE";
  cursor?: string;   // id del último registro visto (cursor opaco)
  limit?: number;    // default 50, max 50
};

export type InvoiceBookPage = {
  items: InvoiceBookRow[];
  nextCursor: string | null; // null si no hay más páginas
  total: number;             // count total para mostrar "X de Y"
};

export class InvoiceService {
  // ─── Calcular pendingAmount inicial (VEN-NIF) ────────────────────────────────
  // pendingAmount = totalAmountVes - ivaRetentionAmount - islrRetentionAmount
  // Las retenciones ya registradas reducen el saldo que el deudor debe pagar.
  static computeInitialPendingAmount(
    totalAmountVes: Decimal,
    ivaRetentionAmount: string,
    islrRetentionAmount: string
  ): Decimal {
    return totalAmountVes
      .minus(new Decimal(ivaRetentionAmount))
      .minus(new Decimal(islrRetentionAmount));
  }

  // ─── Crear factura ───────────────────────────────────────────────────────────
  static async create(input: CreateInvoiceInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? prisma;

    // Fase 16: obtener paymentTermDays para calcular dueDate
    const company = await db.company.findUnique({
      where: { id: input.companyId },
      select: { paymentTermDays: true },
    });
    const paymentTermDays = company?.paymentTermDays ?? 30;
    const dueDate = new Date(input.date);
    dueDate.setDate(dueDate.getDate() + paymentTermDays);

    // Fase 16: calcular totalAmountVes = suma bases + suma IVA de taxLines
    const totalAmountVes = input.taxLines.reduce(
      (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
      new Decimal(0)
    );

    const pendingAmount = InvoiceService.computeInitialPendingAmount(
      totalAmountVes,
      input.ivaRetentionAmount,
      input.islrRetentionAmount
    );

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
        currency: input.currency ?? "VES",
        exchangeRateId: input.exchangeRateId,
        transactionId: input.transactionId,
        periodId: input.periodId,
        createdBy: input.createdBy ?? "",
        idempotencyKey: input.idempotencyKey,
        // Fase 16: campos de cartera
        dueDate,
        totalAmountVes,
        pendingAmount,
        paymentStatus: "UNPAID",
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

  // ─── Listado paginado cursor-based ───────────────────────────────────────────
  // REGLA: nunca findMany sin take. Máximo 50 registros por query.
  static async getInvoicesPaginated(
    companyId: string,
    filters: InvoiceFilters = {},
    cursor?: string,
    limit: number = 50
  ): Promise<InvoicePage> {
    const take = limit + 1;

    // Construir cláusula where
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      deletedAt: null,
    };

    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.dateFrom || filters.dateTo) {
      where.date = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }
    if (filters.paymentStatus) {
      where.paymentStatus = filters.paymentStatus;
    }
    if (filters.search) {
      where.OR = [
        { invoiceNumber: { contains: filters.search } },
        { counterpartName: { contains: filters.search } },
        { counterpartRif: { contains: filters.search } },
      ];
    }

    const invoices = await prisma.invoice.findMany({
      where,
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: {
        id: true,
        date: true,
        invoiceNumber: true,
        controlNumber: true,
        docType: true,
        taxCategory: true,
        type: true,
        counterpartName: true,
        counterpartRif: true,
        currency: true,
        totalAmountVes: true,
        pendingAmount: true,
        paymentStatus: true,
        ivaRetentionAmount: true,
        islrRetentionAmount: true,
        igtfAmount: true,
        dueDate: true,
      },
    });

    const hasNextPage = invoices.length > limit;
    const data = hasNextPage ? invoices.slice(0, limit) : invoices;

    const rows: InvoiceRow[] = data.map((inv) => ({
      id: inv.id,
      date: inv.date,
      invoiceNumber: inv.invoiceNumber,
      controlNumber: inv.controlNumber,
      docType: inv.docType,
      taxCategory: inv.taxCategory,
      type: inv.type,
      counterpartName: inv.counterpartName,
      counterpartRif: inv.counterpartRif,
      currency: inv.currency,
      totalAmountVes: inv.totalAmountVes ? new Decimal(inv.totalAmountVes.toString()).toFixed(2) : null,
      pendingAmount: inv.pendingAmount ? new Decimal(inv.pendingAmount.toString()).toFixed(2) : null,
      paymentStatus: inv.paymentStatus,
      ivaRetentionAmount: new Decimal(inv.ivaRetentionAmount.toString()).toFixed(2),
      islrRetentionAmount: new Decimal(inv.islrRetentionAmount.toString()).toFixed(2),
      igtfAmount: new Decimal(inv.igtfAmount.toString()).toFixed(2),
      dueDate: inv.dueDate,
    }));

    const nextCursor = hasNextPage ? data[data.length - 1].id : null;

    return { data: rows, nextCursor, hasNextPage };
  }

  // ─── Libro paginado por período (cursor-based) ───────────────────────────────
  // REGLA: nunca findMany sin take. Máximo 50 registros por query. (Fase 13C Bloque 2)
  // Filtra por companyId + periodId + type — todos obligatorios para multi-tenant (ADR-004).
  static async getInvoiceBookPaginated(params: InvoiceBookParams): Promise<InvoiceBookPage> {
    const limit = Math.min(params.limit ?? 50, 50);

    const where: Prisma.InvoiceWhereInput = {
      companyId: params.companyId,
      periodId: params.periodId,
      type: params.invoiceType,
      deletedAt: null,
    };

    // Contar total para el indicador "X de Y"
    const total = await prisma.invoice.count({ where });

    const invoices = await prisma.invoice.findMany({
      where,
      take: limit + 1,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { taxLines: true },
    });

    const hasNextPage = invoices.length > limit;
    const page = hasNextPage ? invoices.slice(0, limit) : invoices;
    const nextCursor = hasNextPage ? page[page.length - 1].id : null;

    const items: InvoiceBookRow[] = page.map((inv) => ({
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
      currency: inv.currency,
      exchangeRateId: inv.exchangeRateId,
      taxLines: inv.taxLines.map((line) => ({
        id: line.id,
        taxType: line.taxType,
        base: line.base.toFixed(2),
        rate: line.rate.toFixed(2),
        amount: line.amount.toFixed(2),
      })),
    }));

    return { items, nextCursor, total };
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
      currency: inv.currency,
      exchangeRateId: inv.exchangeRateId,
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
