// src/modules/invoices/services/InvoiceService.ts
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { Prisma, TaxLineType } from "@prisma/client";
import type { CreateInvoiceInput, CreateInvoiceWithLinesInput, InvoiceBookFilter } from "../schemas/invoice.schema";
import {
  computeLineTotals,
  deriveInvoiceTaxLines,
  validateStockForLines,
  createInvoiceLinesInTx,
  type StockWarningItem,
} from "./InvoiceLineService";
import { InvoiceGLPostingService } from "./InvoiceGLPostingService";
import { autoPostMovementInTx } from "@/modules/inventory/services/InventoryAccountingService";
import { PeriodService } from "@/modules/accounting/services/PeriodService";
import { SeniatReportingService } from "./SeniatReportingService";
import {
  createCreditNote as _createCreditNote,
  createDebitNote as _createDebitNote,
  getCreditDebitNotes as _getCreditDebitNotes,
  type CreateCreditDebitNoteInput,
} from "./InvoiceCreditDebitNoteService";

// NC/ND: lógica extraída a InvoiceCreditDebitNoteService.ts (split por tamaño de archivo) — re-exportada abajo.
export type { CreateCreditDebitNoteInput };

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
        // B4: truncar a 2 decimales para consistencia BD ↔ PDF (.toFixed(2))
        base: tl.base.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        rate: tl.rate,
        amount: tl.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        description: null,
      }));
      // totalAmountVes = SUM(InvoiceLine.total) — R-5: todo Decimal.js
      totalAmountVes = computed.reduce((acc, c) => acc.plus(c.total), new Decimal(0));
    } else {
      taxLinesToCreate = input.taxLines.map((line) => ({
        taxType: line.taxType,
        // B4: truncar a 2 decimales para consistencia BD ↔ PDF (.toFixed(2))
        base: new Decimal(line.base).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        rate: new Decimal(line.rate),
        amount: new Decimal(line.amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
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
      // OM-05 + E-14: la factura debe caer en un período existente y no CERRADO (o la
      // empresa no usa períodos aún). Guard centralizado en PeriodService — espejo exacto
      // de la conversión Orden→Factura (OrderService.convertOrderToInvoice).
      // Hallazgo #9: auto-asignar periodId desde el período del mes de la factura cuando el
      // caller no lo provee — garantiza que `getInvoiceBookPaginated` y reportes por período
      // encuentren la factura aunque la UI use filtro por fecha.
      const invoiceDate = new Date(input.date);
      const resolvedFromDate = await PeriodService.resolveFiscalPeriodId(
        db,
        input.companyId,
        invoiceDate,
        "una factura",
      );
      const resolvedPeriodId = input.periodId ?? resolvedFromDate;

      // H-12: validar unicidad de Nº Control por proveedor (COT Art. 101 — ilícito formal)
      // Solo aplica a compras con controlNumber presente
      if (input.type === "PURCHASE" && input.controlNumber && input.counterpartRif) {
        const duplicate = await db.invoice.findFirst({
          where: {
            companyId: input.companyId,
            type: "PURCHASE",
            controlNumber: input.controlNumber,
            counterpartRif: input.counterpartRif,
            deletedAt: null,
          },
          select: { invoiceNumber: true },
        });
        if (duplicate) {
          throw new Error(
            `El Nº Control ${input.controlNumber} ya fue registrado para el proveedor ${input.counterpartRif} (Factura ${duplicate.invoiceNumber}). Un Nº Control duplicado es un ilícito formal (COT Art. 101).`
          );
        }
      }

      // Fase 16: obtener paymentTermDays para calcular dueDate
      // ADR-019: rif necesario para el payload de SeniatSubmission (PA-121)
      const company = await db.company.findUnique({
        where: { id: input.companyId },
        select: { paymentTermDays: true, rif: true },
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
          igtfPayableAccountId: true,         // H-6 — ADR-030
        },
      });

      // H-1/H-2: snapshotear dirección fiscal y estado CE del contacto al momento de emisión
      let snapshotAddress: string | null = (input as { counterpartAddress?: string }).counterpartAddress ?? null;
      let snapshotIsCE = false;
      if (input.counterpartRif) {
        const [vendor, customer] = await Promise.all([
          db.vendor.findFirst({
            where: { companyId: input.companyId, rif: input.counterpartRif, deletedAt: null },
            select: { address: true, isSpecialContributor: true },
          }),
          db.customer.findFirst({
            where: { companyId: input.companyId, rif: input.counterpartRif, deletedAt: null },
            select: { address: true },
          }),
        ]);
        const found = vendor ?? customer;
        if (found && !snapshotAddress) snapshotAddress = found.address ?? null;
        if (vendor) snapshotIsCE = vendor.isSpecialContributor;
      }

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
          counterpartAddress: snapshotAddress,
          counterpartIsSpecialContributor: snapshotIsCE,
          ivaRetentionAmount: new Decimal(input.ivaRetentionAmount),
          ivaRetentionVoucher: input.ivaRetentionVoucher,
          ivaRetentionDate: input.ivaRetentionDate,
          islrRetentionAmount: new Decimal(input.islrRetentionAmount),
          igtfBase: new Decimal(input.igtfBase),
          igtfAmount: new Decimal(input.igtfAmount),
          currency: input.currency ?? "VES",
          exchangeRateId: input.exchangeRateId,
          transactionId: input.transactionId,
          periodId: resolvedPeriodId,
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
            // H-6: IGTF percibido — Decreto Constituyente IGTF 2022
            igtfAmount: new Decimal(input.igtfAmount ?? "0"),
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

      // ─── PA-121: SeniatSubmission en el MISMO $transaction (ADR-019 D-1) ────
      // Solo documentos de VENTA se transmiten al SENIAT (las compras no son
      // documentos emitidos por el contribuyente — ADR-019 D-1.1d).
      // El publish a QStash ocurre POST-COMMIT en la action (D-1.1a: nunca
      // I/O HTTP dentro del $transaction).
      if (input.type === "SALE") {
        const payload = SeniatReportingService.buildPayload(invoice, company?.rif ?? null);
        await SeniatReportingService.createSubmission(db, input.companyId, invoice.id, payload);
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

  // ─── NC/ND: lógica extraída a InvoiceCreditDebitNoteService.ts (split por tamaño de archivo) ──
  static createCreditNote(
    companyId: string,
    data: CreateCreditDebitNoteInput,
    createdBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    return _createCreditNote(companyId, data, createdBy, ipAddress, userAgent);
  }

  static createDebitNote(
    companyId: string,
    data: CreateCreditDebitNoteInput,
    createdBy: string,
    ipAddress: string | null = null,
    userAgent: string | null = null
  ) {
    return _createDebitNote(companyId, data, createdBy, ipAddress, userAgent);
  }

  static getCreditDebitNotes(originalInvoiceId: string, companyId: string) {
    return _getCreditDebitNotes(originalInvoiceId, companyId);
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
export const createCreditNote = _createCreditNote;
export const createDebitNote = _createDebitNote;
export const getCreditDebitNotes = _getCreditDebitNotes;
