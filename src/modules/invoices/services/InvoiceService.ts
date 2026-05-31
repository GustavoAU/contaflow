// src/modules/invoices/services/InvoiceService.ts
import { Decimal } from "decimal.js";
import prismaDefault, { prisma } from "@/lib/prisma";
import type { Prisma, TaxLineType } from "@prisma/client";
import type { CreateInvoiceInput, CreateInvoiceWithLinesInput, InvoiceBookFilter } from "../schemas/invoice.schema";
import * as Sentry from "@sentry/nextjs";
import { redis } from "@/lib/ratelimit";
import {
  computeLineTotals,
  deriveInvoiceTaxLines,
  validateStockForLines,
  createInvoiceLinesInTx,
  type StockWarningItem,
} from "./InvoiceLineService";
import { InvoiceGLPostingService } from "./InvoiceGLPostingService";
import { autoPostMovementInTx } from "@/modules/inventory/services/InventoryAccountingService";
import { getNextControlNumber } from "./InvoiceSequenceService";

// ─── Types for NC/ND ─────────────────────────────────────────────────────────
export type CreateCreditDebitNoteInput = {
  relatedInvoiceId: string;
  invoiceNumber: string;
  date: Date;
  counterpartName: string;
  counterpartRif: string;
  taxLines: Array<{ taxType: string; base: string; rate: string; amount: string; description?: string }>;
  ivaRetentionAmount: string;
  islrRetentionAmount: string;
  igtfBase: string;
  igtfAmount: string;
  currency: string;
  companyId?: string;
  type?: string;
  docType?: string;
  taxCategory?: string;
  [key: string]: unknown;
};

// ─── Tipos de retorno ──────────────────────────────────────────────────────────
export type InvoiceTaxLineSerialized = {
  id: string;
  taxType: string;
  base: string;
  rate: string;
  amount: string;
  description: string | null;
};

export type InvoiceBookExchangeRate = {
  foreignCurrency: string; // e.g. "USD"
  rate: string;            // VES per 1 foreignCurrency unit
  date: string;            // ISO date string
  source: string;          // e.g. "BCV"
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
  exchangeRate: InvoiceBookExchangeRate | null;
  taxLines: InvoiceTaxLineSerialized[];
  /** Estado de transmisión SENIAT (PA-121) — solo para facturas SALE; null si no aplica */
  seniatStatus: "PENDING" | "SENT" | "FAILED" | null;
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

// P2034 retry delays in ms: 0ms before attempt 1, 50ms before attempt 2, 100ms before attempt 3
const P2034_DELAYS = [0, 50, 100] as const;

function isP2034(err: unknown): err is Error {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "P2034";
}

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
  // Acepta tanto CreateInvoiceInput (legacy sin líneas) como CreateInvoiceWithLinesInput (con líneas)
  // ADR-024 D-1.3: dos caminos según input.lines presente o no
  // ADR-026: GL auto-posting envuelve las escrituras en $transaction para atomicidad
  static async create(
    input: CreateInvoiceInput | CreateInvoiceWithLinesInput,
    outerTx?: Prisma.TransactionClient
  ) {
    const inputWithLines = input as CreateInvoiceWithLinesInput;
    const hasLines = !!(inputWithLines.lines && inputWithLines.lines.length > 0);

    // ─── Path con líneas: validar stock PRE-$transaction ────────────────────
    // La validación ocurre fuera de la $transaction (ADR-024 D-2.3 paso 1)
    const computed = hasLines ? computeLineTotals(inputWithLines.lines!) : [];
    let stockWarnings: StockWarningItem[] = [];
    if (hasLines) {
      const settings = await prisma.companySettings.findUnique({
        where: { companyId: input.companyId },
        select: { stockControlLevel: true },
      });
      const stockLevel = settings?.stockControlLevel ?? "WARN";
      // Pre-validación usa Read Committed — no requiere $transaction
      await prisma.$transaction(async (checkTx) => {
        const stockResult = await validateStockForLines(
          inputWithLines.lines!,
          input.companyId,
          stockLevel,
          inputWithLines.stockConfirmed ?? false,
          checkTx
        );
        if (stockResult.ok && stockResult.warnings) {
          stockWarnings = stockResult.warnings;
        }
      });
    }

    // ─── Pre-computar taxLines (puro — sin DB) ───────────────────────────────
    let taxLinesToCreate: Array<{
      taxType: string; base: Decimal; rate: Decimal; amount: Decimal; description?: string | null;
    }>;
    let totalAmountVes: Decimal;

    if (hasLines) {
      const derivedTaxLines = deriveInvoiceTaxLines(computed);
      taxLinesToCreate = derivedTaxLines.map((tl) => ({
        taxType: tl.taxType,
        base: tl.base,
        rate: tl.rate,
        amount: tl.amount,
        description: null,
      }));
      // totalAmountVes = SUM(InvoiceLine.total) — R-5: todo Decimal.js
      totalAmountVes = computed.reduce((acc, c) => acc.plus(c.total), new Decimal(0));
    } else {
      taxLinesToCreate = input.taxLines.map((line) => ({
        taxType: line.taxType,
        base: new Decimal(line.base),
        rate: new Decimal(line.rate),
        amount: new Decimal(line.amount),
        description: line.description ?? null,
      }));
      totalAmountVes = input.taxLines.reduce(
        (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
        new Decimal(0)
      );
    }

    const pendingAmount = InvoiceService.computeInitialPendingAmount(
      totalAmountVes,
      input.ivaRetentionAmount,
      input.islrRetentionAmount
    );

    // ─── Escrituras DB atomizadas + GL posting (ADR-026) ─────────────────────
    const doCreate = async (db: Prisma.TransactionClient) => {
      // OM-05: bloquear fechas en períodos contables CERRADOS
      // (misma guarda que R-09 en InventoryOperationsService)
      const invoiceDate = new Date(input.date);
      const invYear = invoiceDate.getFullYear();
      const invMonth = invoiceDate.getMonth() + 1; // getMonth() es 0-based
      const closedPeriod = await db.accountingPeriod.findFirst({
        where: { companyId: input.companyId, status: "CLOSED", year: invYear, month: invMonth },
        select: { year: true, month: true },
      });
      if (closedPeriod) {
        throw new Error(
          `No se puede registrar una factura en el período ${String(closedPeriod.month).padStart(2, "0")}/${closedPeriod.year} porque está CERRADO. Use una fecha en el período activo.`
        );
      }

      // Fase 16: obtener paymentTermDays para calcular dueDate
      const company = await db.company.findUnique({
        where: { id: input.companyId },
        select: { paymentTermDays: true },
      });
      const paymentTermDays = company?.paymentTermDays ?? 30;
      const dueDate = new Date(input.date);
      dueDate.setDate(dueDate.getDate() + paymentTermDays);

      // Leer config en una sola query (stockControlLevel + GL accounts)
      const settings = await db.companySettings.findUnique({
        where: { companyId: input.companyId },
        select: {
          stockControlLevel: true,
          arAccountId: true,
          apAccountId: true,
          salesAccountId: true,
          purchaseExpenseAccountId: true,
          inventoryAccountId: true,
          ivaDFAccountId: true,
          ivaCFAccountId: true,
          ivaRetentionPayableAccountId: true, // GAP-03
        },
      });

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
            create: taxLinesToCreate.map((tl) => ({
              taxType: tl.taxType as TaxLineType,
              base: tl.base,
              rate: tl.rate,
              amount: tl.amount,
              description: tl.description ?? null,
            })),
          },
        },
        include: { taxLines: true },
      });

      // ─── Path con líneas: crear InvoiceLines + InventoryMovements DRAFT ────
      if (hasLines && computed.length > 0) {
        const stockLevel = settings?.stockControlLevel ?? "WARN";
        await createInvoiceLinesInTx(
          invoice.id,
          input.companyId,
          computed,
          new Date(input.date),
          input.createdBy ?? "",
          stockLevel,
          db,
          input.type as "SALE" | "PURCHASE"  // OM-01: tipo de movimiento correcto
        );
      }

      // ─── GL auto-posting (ADR-026) ──────────────────────────────────────────
      // Solo si no se pasó transactionId explícito y la config GL está completa
      let glTransactionId: string | null = null;
      if (!input.transactionId && settings && InvoiceGLPostingService.canPost(input.type as "SALE" | "PURCHASE", settings)) {
        // NIC 21: obtener tasa histórica para enriquecer descripción GL (ALERTA 1)
        let exchangeRateVes: Decimal | null = null;
        if (input.exchangeRateId && (input.currency ?? "VES") !== "VES") {
          const er = await db.exchangeRate.findUnique({
            where: { id: input.exchangeRateId },
            select: { rate: true },
          });
          exchangeRateVes = er ? new Decimal(er.rate.toString()) : null;
        }

        glTransactionId = await InvoiceGLPostingService.postInvoice(
          {
            id: invoice.id,
            type: input.type as "SALE" | "PURCHASE",
            invoiceNumber: input.invoiceNumber,
            counterpartName: input.counterpartName,
            date: input.date,
            periodId: input.periodId ?? null,
            totalAmountVes,
            taxLines: invoice.taxLines,
            currency: input.currency ?? "VES",
            exchangeRateVes,
          },
          settings,
          input.companyId,
          input.createdBy ?? "",
          db
        );
      }

      // ─── OM-01: Contabilización automática de movimientos de inventario ─────
      // Para ítems con trackingType = NONE:
      //   SALIDA (venta):   Dr COGS / Cr Inventario en nuevo asiento
      //   ENTRADA (compra): reutiliza glTransactionId de la factura (Dr Inventario ya existe)
      // Para LOT/SERIAL: el movimiento queda en DRAFT para contabilización manual.
      if (hasLines) {
        const draftMovements = await db.inventoryMovement.findMany({
          where: { invoiceId: invoice.id, status: "DRAFT" },
          select: { id: true, type: true },
        });
        for (const m of draftMovements) {
          // ENTRADA solo si la factura tiene GL (para reutilizar Dr Inventario del asiento)
          if (m.type === "ENTRADA" && !glTransactionId) continue;
          await autoPostMovementInTx(
            db,
            m.id,
            input.companyId,
            input.createdBy ?? "",
            m.type === "ENTRADA" ? glTransactionId : null
          );
        }
      }

      // Re-fetch para incluir transactionId actualizado (si GL posting ocurrió)
      if (glTransactionId) {
        return db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { taxLines: true } });
      }
      return invoice;
    };

    const inv = await (outerTx ? doCreate(outerTx) : prisma.$transaction(doCreate, { timeout: 10000 }));
    return Object.assign(inv, { stockWarnings });
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

    const invoices = await prisma.invoice.findMany({ // ADR-004-EXCEPTION: companyId en 'where' construido arriba con Prisma.InvoiceWhereInput
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
      exchangeRate: null, // paginated book view doesn't include rate details
      seniatStatus: null, // paginated view omits SENIAT status
      taxLines: inv.taxLines.map((line) => ({
        id: line.id,
        taxType: line.taxType,
        base: line.base.toFixed(2),
        rate: line.rate.toFixed(2),
        amount: line.amount.toFixed(2),
        description: line.description ?? null,
      })),
    }));

    return { items, nextCursor, total };
  }

  // ─── Crear Nota de Crédito ───────────────────────────────────────────────────
  static async createCreditNote(
    companyId: string,
    data: CreateCreditDebitNoteInput,
    createdBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    const MAX_ATTEMPTS = 3;
    let lastP2034Err: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

      const txStart = Date.now();
      try {
    return await prismaDefault.$transaction(
      async (tx) => {
        // Guard multi-tenant: findFirst with companyId prevents IDOR (ADR-004)
        const original = await tx.invoice.findFirst({
          where: { id: data.relatedInvoiceId, companyId },
        });
        if (!original) {
          throw new Error("Factura original no encontrada o no pertenece a esta empresa");
        }

        // Loop prevention: only FACTURA can have NC/ND
        if (original.docType !== "FACTURA") {
          throw new Error("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
        }

        // Void guard: deletedAt or paymentStatus VOIDED
        if (original.deletedAt || original.paymentStatus === "VOIDED") {
          throw new Error("La factura original está anulada");
        }

        // Calculate totalAmountVes from taxLines (never trust client-side totalAmountVes)
        const totalAmountVes = data.taxLines.reduce(
          (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
          new Decimal(0)
        );

        // Amount guard
        const pendingAmount = original.pendingAmount ? new Decimal(original.pendingAmount.toString()) : new Decimal(0);
        if (totalAmountVes.greaterThan(pendingAmount)) {
          throw new Error("El monto de la nota supera el saldo pendiente de la factura original");
        }

        // Derive relatedDocNumber server-side — never from client input
        const relatedDocNumber = original.invoiceNumber;

        // H-002: auto-generar Nº Control para NC de Venta (Prov. 0071 Art. 14)
        const ncType = ((data.type as string) || original.type) as "SALE" | "PURCHASE";
        let ncControlNumber = (data as { controlNumber?: string }).controlNumber;
        if (ncType === "SALE" && !ncControlNumber) {
          ncControlNumber = await getNextControlNumber(tx, companyId, "SALE");
        }

        // Create the NC invoice
        const nc = await tx.invoice.create({
          data: {
            companyId,
            type: ncType,
            docType: "NOTA_CREDITO",
            taxCategory: (data.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION") ?? original.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION",
            invoiceNumber: data.invoiceNumber,
            controlNumber: ncControlNumber ?? null,
            date: data.date,
            counterpartName: data.counterpartName,
            counterpartRif: data.counterpartRif,
            ivaRetentionAmount: new Decimal(data.ivaRetentionAmount),
            islrRetentionAmount: new Decimal(data.islrRetentionAmount),
            igtfBase: new Decimal(data.igtfBase),
            igtfAmount: new Decimal(data.igtfAmount),
            currency: (data.currency as "VES" | "USD" | "EUR") ?? "VES",
            totalAmountVes,
            pendingAmount: new Decimal(0),
            paymentStatus: "PAID",
            relatedInvoiceId: data.relatedInvoiceId,
            relatedDocNumber,
            createdBy,
            taxLines: {
              create: data.taxLines.map((line) => ({
                taxType: line.taxType as TaxLineType,
                base: new Decimal(line.base),
                rate: new Decimal(line.rate),
                amount: new Decimal(line.amount),
                description: line.description ?? null,
              })),
            },
          },
          include: { taxLines: true },
        });

        // Update original invoice pendingAmount and paymentStatus
        const newPending = pendingAmount.minus(totalAmountVes);
        const newStatus = newPending.lessThanOrEqualTo(new Decimal(0)) ? "PAID" : "PARTIAL";
        await tx.invoice.update({
          where: { id: original.id },
          data: {
            pendingAmount: newPending,
            paymentStatus: newStatus,
          },
        });

        // AuditLog #1: NC creation
        await tx.auditLog.create({
          data: {
            companyId,
            entityId: nc.id,
            entityName: "Invoice",
            action: "CREATE_NC",
            userId: createdBy,
            ipAddress,
            userAgent,
            newValue: {
              invoiceNumber: nc.invoiceNumber,
              relatedInvoiceId: data.relatedInvoiceId,
              relatedDocNumber,
              totalAmountVes: totalAmountVes.toFixed(2),
              companyId,
            },
          },
        });

        // AuditLog #2: original invoice pendingAmount update
        await tx.auditLog.create({
          data: {
            companyId,
            entityId: original.id,
            entityName: "Invoice",
            action: "PENDING_AMOUNT_UPDATE",
            userId: createdBy,
            ipAddress,
            userAgent,
            newValue: {
              pendingAmount: newPending.toFixed(2),
              paymentStatus: newStatus,
            },
          },
        });

        return nc;
      },
      { isolationLevel: "Serializable" }
    );
      } catch (err: unknown) {
        if (isP2034(err)) {
          if (redis) {
            const key = `p2034:${companyId}:${new Date().toISOString().slice(0, 10)}`;
            await redis.pipeline().incr(key).expire(key, 604800).exec().catch(() => {});
          }
          lastP2034Err = err;
          if (attempt === MAX_ATTEMPTS) {
            Sentry.withScope((scope) => {
              scope.setTag("companyId", companyId);
              scope.setExtra("attempt", attempt);
              scope.setExtra("duration_ms", Date.now() - txStart);
              Sentry.captureMessage("P2034 createCreditNote", "warning");
            });
          }
          continue;
        }
        throw err;
      }
    }

    void lastP2034Err;
    throw new Error("Conflicto de concurrencia — reintente la operación");
  }

  // ─── Crear Nota de Débito ────────────────────────────────────────────────────
  static async createDebitNote(
    companyId: string,
    data: CreateCreditDebitNoteInput,
    createdBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    const MAX_ATTEMPTS = 3;
    let lastP2034Err: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));

      const txStart = Date.now();
      try {
    return await prismaDefault.$transaction(
      async (tx) => {
        // Guard multi-tenant: findFirst with companyId prevents IDOR (ADR-004)
        const original = await tx.invoice.findFirst({
          where: { id: data.relatedInvoiceId, companyId },
        });
        if (!original) {
          throw new Error("Factura original no encontrada o no pertenece a esta empresa");
        }

        // Loop prevention: only FACTURA can have NC/ND
        if (original.docType !== "FACTURA") {
          throw new Error("Solo se pueden emitir notas sobre Facturas (no sobre NC/ND)");
        }

        // Soft-delete + VOID guard (ADR-006 HIGH-1: ambas condiciones obligatorias en NC y ND)
        if (original.deletedAt || original.paymentStatus === "VOIDED") {
          throw new Error("La factura original está anulada");
        }

        // Calculate totalAmountVes from taxLines
        const totalAmountVes = data.taxLines.reduce(
          (acc, line) => acc.plus(new Decimal(line.base)).plus(new Decimal(line.amount)),
          new Decimal(0)
        );

        // Derive relatedDocNumber server-side
        const relatedDocNumber = original.invoiceNumber;

        // H-002: auto-generar Nº Control para ND de Venta (Prov. 0071 Art. 14)
        const ndType = ((data.type as string) || original.type) as "SALE" | "PURCHASE";
        let ndControlNumber = (data as { controlNumber?: string }).controlNumber;
        if (ndType === "SALE" && !ndControlNumber) {
          ndControlNumber = await getNextControlNumber(tx, companyId, "SALE");
        }

        // Create the ND invoice
        const nd = await tx.invoice.create({
          data: {
            companyId,
            type: ndType,
            docType: "NOTA_DEBITO",
            taxCategory: (data.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION") ?? original.taxCategory as "GRAVADA" | "EXENTA" | "EXONERADA" | "NO_SUJETA" | "IMPORTACION",
            invoiceNumber: data.invoiceNumber,
            controlNumber: ndControlNumber ?? null,
            date: data.date,
            counterpartName: data.counterpartName,
            counterpartRif: data.counterpartRif,
            ivaRetentionAmount: new Decimal(data.ivaRetentionAmount),
            islrRetentionAmount: new Decimal(data.islrRetentionAmount),
            igtfBase: new Decimal(data.igtfBase),
            igtfAmount: new Decimal(data.igtfAmount),
            currency: (data.currency as "VES" | "USD" | "EUR") ?? "VES",
            totalAmountVes,
            pendingAmount: totalAmountVes,
            paymentStatus: "UNPAID",
            relatedInvoiceId: data.relatedInvoiceId,
            relatedDocNumber,
            createdBy,
            taxLines: {
              create: data.taxLines.map((line) => ({
                taxType: line.taxType as TaxLineType,
                base: new Decimal(line.base),
                rate: new Decimal(line.rate),
                amount: new Decimal(line.amount),
                description: line.description ?? null,
              })),
            },
          },
          include: { taxLines: true },
        });

        // Update original invoice: pendingAmount increases, recalculate paymentStatus
        const originalPending = original.pendingAmount ? new Decimal(original.pendingAmount.toString()) : new Decimal(0);
        const newPending = originalPending.plus(totalAmountVes);
        // If was PAID and pendingAmount > 0 → PARTIAL; otherwise keep UNPAID
        const currentStatus = original.paymentStatus;
        const newStatus = newPending.greaterThan(new Decimal(0)) && currentStatus === "PAID"
          ? "PARTIAL"
          : currentStatus === "PAID" ? "PAID" : "UNPAID";

        await tx.invoice.update({
          where: { id: original.id },
          data: {
            pendingAmount: newPending,
            paymentStatus: newStatus,
          },
        });

        // AuditLog #1: ND creation
        await tx.auditLog.create({
          data: {
            companyId,
            entityId: nd.id,
            entityName: "Invoice",
            action: "CREATE_ND",
            userId: createdBy,
            ipAddress,
            userAgent,
            newValue: {
              invoiceNumber: nd.invoiceNumber,
              relatedInvoiceId: data.relatedInvoiceId,
              relatedDocNumber,
              totalAmountVes: totalAmountVes.toFixed(2),
              companyId,
            },
          },
        });

        // AuditLog #2: original invoice pendingAmount update
        await tx.auditLog.create({
          data: {
            companyId,
            entityId: original.id,
            entityName: "Invoice",
            action: "PENDING_AMOUNT_UPDATE",
            userId: createdBy,
            ipAddress,
            userAgent,
            newValue: {
              pendingAmount: newPending.toFixed(2),
              paymentStatus: newStatus,
            },
          },
        });

        return nd;
      },
      { isolationLevel: "Serializable" }
    );
      } catch (err: unknown) {
        if (isP2034(err)) {
          if (redis) {
            const key = `p2034:${companyId}:${new Date().toISOString().slice(0, 10)}`;
            await redis.pipeline().incr(key).expire(key, 604800).exec().catch(() => {});
          }
          lastP2034Err = err;
          if (attempt === MAX_ATTEMPTS) {
            Sentry.withScope((scope) => {
              scope.setTag("companyId", companyId);
              scope.setExtra("attempt", attempt);
              scope.setExtra("duration_ms", Date.now() - txStart);
              Sentry.captureMessage("P2034 createDebitNote", "warning");
            });
          }
          continue;
        }
        throw err;
      }
    }

    void lastP2034Err;
    throw new Error("Conflicto de concurrencia — reintente la operación");
  }

  // ─── Obtener NC/ND de una factura ────────────────────────────────────────────
  static async getCreditDebitNotes(originalInvoiceId: string, companyId: string) {
    return prismaDefault.invoice.findMany({
      where: {
        relatedInvoiceId: originalInvoiceId,
        companyId,
        deletedAt: null,
      },
      orderBy: [{ date: "asc" }],
    });
  }

  // ─── Obtener libro ───────────────────────────────────────────────────────────
  static async getBook(filter: InvoiceBookFilter): Promise<InvoiceBookResult> {
    // H-004: soporta modo período (year/month) y modo rango (startDate/endDate).
    // FAC-4: Date.UTC garantiza medianoche UTC independiente de la zona horaria del servidor.
    let startDate: Date;
    let endDate: Date;
    if (filter.startDate && filter.endDate) {
      startDate = new Date(Date.UTC(
        filter.startDate.getUTCFullYear(), filter.startDate.getUTCMonth(), filter.startDate.getUTCDate()
      ));
      // endDate inclusivo: avanzar al día siguiente para que `lt` capture todo el día final
      endDate = new Date(Date.UTC(
        filter.endDate.getUTCFullYear(), filter.endDate.getUTCMonth(), filter.endDate.getUTCDate() + 1
      ));
    } else {
      const year = filter.year!;
      const month = filter.month!;
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate   = new Date(Date.UTC(year, month, 1));
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId: filter.companyId,
        type: filter.type,
        date: { gte: startDate, lt: endDate },
        deletedAt: null,
      },
      include: { taxLines: true, retenciones: { where: { deletedAt: null } }, exchangeRate: true, seniatSubmission: { select: { status: true } } },
      orderBy: { date: "asc" },
    });

    // ─── Serializar ──────────────────────────────────────────────────────────
    const rows: InvoiceBookRow[] = invoices.map((inv) => {
      // Derivar montos de retención desde Retenciones vinculadas (fuente de verdad)
      // Fallback: campos denormalizados de Invoice si no hay retenciones vinculadas
      const ivaFromRet = inv.retenciones
        .filter((r) => r.type === "IVA" || r.type === "AMBAS")
        .reduce((sum, r) => sum.plus(r.ivaRetention), new Decimal(0));
      const islrFromRet = inv.retenciones
        .filter((r) => r.type === "ISLR" || r.type === "AMBAS")
        .reduce((sum, r) => sum.plus(r.islrAmount ?? new Decimal(0)), new Decimal(0));
      const hasLinked = inv.retenciones.length > 0;
      const ivaRetentionAmount = hasLinked ? ivaFromRet.toFixed(2) : inv.ivaRetentionAmount.toFixed(2);
      const islrRetentionAmount = hasLinked ? islrFromRet.toFixed(2) : inv.islrRetentionAmount.toFixed(2);

      return {
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
        ivaRetentionAmount,
        ivaRetentionVoucher: inv.ivaRetentionVoucher,
        ivaRetentionDate: inv.ivaRetentionDate,
        islrRetentionAmount,
        igtfBase: inv.igtfBase.toFixed(2),
        igtfAmount: inv.igtfAmount.toFixed(2),
        currency: inv.currency,
        exchangeRateId: inv.exchangeRateId,
        exchangeRate: inv.exchangeRate && inv.currency !== "VES"
          ? {
              foreignCurrency: inv.currency,
              rate: inv.exchangeRate.rate.toFixed(6),
              date: inv.exchangeRate.date.toISOString(),
              source: inv.exchangeRate.source,
            }
          : null,
        taxLines: inv.taxLines.map((line) => ({
          id: line.id,
          taxType: line.taxType,
          base: line.base.toFixed(2),
          rate: line.rate.toFixed(2),
          amount: line.amount.toFixed(2),
          description: line.description ?? null,
        })),
        seniatStatus: (inv.seniatSubmission?.status ?? null) as "PENDING" | "SENT" | "FAILED" | null,
      };
    });

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

    const summary: InvoiceBookSummary = {
      totalBaseGeneral: sumTaxBases("IVA_GENERAL"),
      totalIvaGeneral: sumTaxLines("IVA_GENERAL"),
      totalBaseReduced: sumTaxBases("IVA_REDUCIDO"),
      totalIvaReduced: sumTaxLines("IVA_REDUCIDO"),
      totalBaseAdditional: sumTaxBases("IVA_ADICIONAL"),
      totalIvaAdditional: sumTaxLines("IVA_ADICIONAL"),
      totalExempt: sumTaxBases("EXENTO"),
      // Sumar desde rows — ya incorporan montos derivados de Retenciones vinculadas
      totalIvaRetention: rows.reduce((acc, r) => acc.plus(new Decimal(r.ivaRetentionAmount)), new Decimal(0)).toFixed(2),
      totalIslrRetention: rows.reduce((acc, r) => acc.plus(new Decimal(r.islrRetentionAmount)), new Decimal(0)).toFixed(2),
      totalIgtf: invoices.reduce((acc, inv) => acc.plus(inv.igtfAmount), new Decimal(0)).toFixed(2),
    };

    return { rows, summary };
  }
}

// ─── Named exports for direct imports (used in tests and external callers) ────
export const createCreditNote = InvoiceService.createCreditNote.bind(InvoiceService);
export const createDebitNote = InvoiceService.createDebitNote.bind(InvoiceService);
export const getCreditDebitNotes = InvoiceService.getCreditDebitNotes.bind(InvoiceService);
