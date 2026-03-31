// src/modules/receivables/services/ReceivableService.ts
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type AgingBucket =
  | "CURRENT"
  | "OVERDUE_31_60"
  | "OVERDUE_61_90"
  | "OVERDUE_91_120"
  | "OVERDUE_120_PLUS";

export type ReceivableRow = {
  invoiceId: string;
  invoiceNumber: string;
  controlNumber: string | null;
  docType: string;
  counterpartName: string;
  counterpartRif: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  totalAmountOriginal: string;
  totalAmountVes: string;
  paidAmountVes: string;
  pendingAmountVes: string;
  daysOverdue: number;
  bucket: AgingBucket;
  paymentStatus: string;
};

export type AgingBucketSummary = {
  bucket: AgingBucket;
  label: string;
  count: number;
  totalPendingVes: string;
};

export type AgingReport = {
  type: "CXC" | "CXP";
  asOf: Date;
  rows: ReceivableRow[];
  bucketSummary: AgingBucketSummary[];
  grandTotalPendingVes: string;
  grandTotalCurrentVes: string;
  grandTotalOverdueVes: string;
};

export type InvoicePaymentSummary = {
  id: string;
  invoiceId: string;
  amount: string;
  currency: string;
  amountOriginal: string | null;
  method: string;
  referenceNumber: string | null;
  igtfAmount: string | null;
  date: Date;
  notes: string | null;
  createdBy: string;
  createdAt: Date;
  idempotencyKey: string;
};

export type RecordPaymentInput = {
  companyId: string;
  invoiceId: string;
  amount: string;          // Decimal como string — monto en VES
  currency: string;
  amountOriginal?: string;
  exchangeRateId?: string;
  method: string;
  referenceNumber?: string;
  originBank?: string;
  destBank?: string;
  commissionPct?: string;
  igtfAmount?: string;
  date: Date;
  notes?: string;
  createdBy: string;
  idempotencyKey: string;
};

// ─── Retry logic para cold-start en Neon serverless ──────────────────────────

const RETRYABLE_ERRORS = [
  "Unable to start a transaction",
  "Transaction API error",
  "connection timeout",
  "P1001",
  "P1008",
];

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  const delays = [0, 500, 1000];
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (delays[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = RETRYABLE_ERRORS.some((e) => msg.includes(e));
      if (!isRetryable) throw err;
    }
  }
  throw lastError;
}

// DocTypes que representan deuda (suman al saldo de cartera)
const DEBT_DOC_TYPES = ["FACTURA", "NOTA_DEBITO"] as const;
// DocTypes que reducen deuda (notas de crédito)
const CREDIT_DOC_TYPES = ["NOTA_CREDITO"] as const;

const BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "Corriente",
  OVERDUE_31_60: "31–60 días",
  OVERDUE_61_90: "61–90 días",
  OVERDUE_91_120: "91–120 días",
  OVERDUE_120_PLUS: "+120 días",
};

// ─── Pure function: clasificar bucket de antigüedad ──────────────────────────
// Exported for unit testing in isolation.
export function classifyAgingBucket(
  dueDate: Date | null,
  invoiceDate: Date,
  asOf: Date
): AgingBucket {
  const effectiveDue = dueDate ?? invoiceDate;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysOverdue = Math.floor((asOf.getTime() - effectiveDue.getTime()) / msPerDay);

  if (daysOverdue <= 30) return "CURRENT";
  if (daysOverdue <= 60) return "OVERDUE_31_60";
  if (daysOverdue <= 90) return "OVERDUE_61_90";
  if (daysOverdue <= 120) return "OVERDUE_91_120";
  return "OVERDUE_120_PLUS";
}

// ─── Función interna: construir aging report desde facturas ──────────────────
async function buildAgingReport(
  companyId: string,
  invoiceType: "SALE" | "PURCHASE",
  asOf: Date
): Promise<AgingReport> {
  const reportType: "CXC" | "CXP" = invoiceType === "SALE" ? "CXC" : "CXP";

  // Traer FACTURA, NOTA_DEBITO (deuda) y NOTA_CREDITO (reduce)
  // Excluir PAID, deletedAt no nulo, REPORTE_Z y RESUMEN_VENTAS
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      type: invoiceType,
      deletedAt: null,
      docType: {
        in: [...DEBT_DOC_TYPES, ...CREDIT_DOC_TYPES],
      },
      paymentStatus: { not: "PAID" },
    },
    select: {
      id: true,
      invoiceNumber: true,
      controlNumber: true,
      docType: true,
      counterpartName: true,
      counterpartRif: true,
      relatedDocNumber: true,
      date: true,
      dueDate: true,
      currency: true,
      totalAmountVes: true,
      pendingAmount: true,
      paymentStatus: true,
      invoicePayments: {
        where: { deletedAt: null },
        select: { amount: true },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  // Separar facturas de deuda vs notas de crédito
  const debtInvoices = invoices.filter((inv) =>
    (DEBT_DOC_TYPES as readonly string[]).includes(inv.docType)
  );
  const creditNotes = invoices.filter((inv) =>
    (CREDIT_DOC_TYPES as readonly string[]).includes(inv.docType)
  );

  // Construir mapa de créditos por relatedDocNumber para neteo (BLOQUEANTE 4)
  const creditByRelatedDoc = new Map<string, Decimal>();
  for (const cn of creditNotes) {
    if (cn.relatedDocNumber) {
      const cnTotal = cn.totalAmountVes ? new Decimal(cn.totalAmountVes.toString()) : new Decimal(0);
      const existing = creditByRelatedDoc.get(cn.relatedDocNumber) ?? new Decimal(0);
      creditByRelatedDoc.set(cn.relatedDocNumber, existing.plus(cnTotal));
    }
  }

  const rows: ReceivableRow[] = [];

  for (const inv of debtInvoices) {
    const totalVes = inv.totalAmountVes ? new Decimal(inv.totalAmountVes.toString()) : new Decimal(0);
    const paidVes = inv.invoicePayments.reduce(
      (acc, p) => acc.plus(new Decimal(p.amount.toString())),
      new Decimal(0)
    );
    // Aplicar créditos neteados por número de documento
    const creditApplied = creditByRelatedDoc.get(inv.invoiceNumber) ?? new Decimal(0);
    const rawPending = inv.pendingAmount
      ? new Decimal(inv.pendingAmount.toString())
      : totalVes.minus(paidVes);
    const pendingVes = Decimal.max(rawPending.minus(creditApplied), new Decimal(0));

    const msPerDay = 1000 * 60 * 60 * 24;
    const effectiveDue = inv.dueDate ?? inv.date;
    const daysOverdue = Math.floor((asOf.getTime() - effectiveDue.getTime()) / msPerDay);
    const bucket = classifyAgingBucket(inv.dueDate, inv.date, asOf);

    rows.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      controlNumber: inv.controlNumber,
      docType: inv.docType,
      counterpartName: inv.counterpartName,
      counterpartRif: inv.counterpartRif,
      invoiceDate: inv.date,
      dueDate: inv.dueDate,
      currency: inv.currency,
      totalAmountOriginal: totalVes.toFixed(2),
      totalAmountVes: totalVes.toFixed(2),
      paidAmountVes: paidVes.toFixed(2),
      pendingAmountVes: pendingVes.toFixed(2),
      daysOverdue,
      bucket,
      paymentStatus: inv.paymentStatus,
    });
  }

  // Ordenar: más vencidas primero
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

  // ─── Resumen por bucket ────────────────────────────────────────────────────
  const allBuckets: AgingBucket[] = [
    "OVERDUE_120_PLUS",
    "OVERDUE_91_120",
    "OVERDUE_61_90",
    "OVERDUE_31_60",
    "CURRENT",
  ];

  const bucketSummary: AgingBucketSummary[] = allBuckets.map((bucket) => {
    const bucketRows = rows.filter((r) => r.bucket === bucket);
    const total = bucketRows.reduce(
      (acc, r) => acc.plus(new Decimal(r.pendingAmountVes)),
      new Decimal(0)
    );
    return {
      bucket,
      label: BUCKET_LABELS[bucket],
      count: bucketRows.length,
      totalPendingVes: total.toFixed(2),
    };
  });

  const grandTotal = rows.reduce(
    (acc, r) => acc.plus(new Decimal(r.pendingAmountVes)),
    new Decimal(0)
  );
  const currentTotal = rows
    .filter((r) => r.bucket === "CURRENT")
    .reduce((acc, r) => acc.plus(new Decimal(r.pendingAmountVes)), new Decimal(0));
  const overdueTotal = grandTotal.minus(currentTotal);

  return {
    type: reportType,
    asOf,
    rows,
    bucketSummary,
    grandTotalPendingVes: grandTotal.toFixed(2),
    grandTotalCurrentVes: currentTotal.toFixed(2),
    grandTotalOverdueVes: overdueTotal.toFixed(2),
  };
}

// ─── Servicio público ─────────────────────────────────────────────────────────

export class ReceivableService {
  // ─── Aging CxC (Cuentas por Cobrar) ─────────────────────────────────────────
  static async getReceivables(companyId: string, asOf?: Date): Promise<AgingReport> {
    return buildAgingReport(companyId, "SALE", asOf ?? new Date());
  }

  // ─── Aging CxP (Cuentas por Pagar) ──────────────────────────────────────────
  static async getPayables(companyId: string, asOf?: Date): Promise<AgingReport> {
    return buildAgingReport(companyId, "PURCHASE", asOf ?? new Date());
  }

  // ─── Registrar pago sobre una factura ───────────────────────────────────────
  static async recordPayment(
    input: RecordPaymentInput,
    tx?: Prisma.TransactionClient
  ): Promise<InvoicePaymentSummary> {
    const run = async (db: Prisma.TransactionClient): Promise<InvoicePaymentSummary> => {
      // Verificar idempotencia
      const existing = await db.invoicePayment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        throw new Error("Pago duplicado — ya existe un pago con esta clave de idempotencia");
      }

      // Verificar factura
      const invoice = await db.invoice.findFirst({
        where: { id: input.invoiceId, companyId: input.companyId, deletedAt: null },
        select: { id: true, date: true, paymentStatus: true, pendingAmount: true, totalAmountVes: true },
      });
      if (!invoice) throw new Error("Factura no encontrada o eliminada");
      if (invoice.paymentStatus === "PAID") throw new Error("La factura ya está completamente pagada");

      // Guard: año fiscal cerrado
      const invoiceYear = invoice.date.getFullYear();
      const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(input.companyId, invoiceYear);
      if (yearClosed) {
        throw new Error(`El ejercicio económico ${invoiceYear} está cerrado. No se pueden registrar pagos en facturas de ese año`);
      }

      const paymentAmount = new Decimal(input.amount);
      const currentPending = invoice.pendingAmount
        ? new Decimal(invoice.pendingAmount.toString())
        : (invoice.totalAmountVes ? new Decimal(invoice.totalAmountVes.toString()) : new Decimal(0));

      if (paymentAmount.greaterThan(currentPending)) {
        throw new Error("El monto del pago excede el saldo pendiente");
      }

      // Crear InvoicePayment
      const payment = await db.invoicePayment.create({
        data: {
          companyId: input.companyId,
          invoiceId: input.invoiceId,
          amount: paymentAmount,
          currency: input.currency as never,
          amountOriginal: input.amountOriginal ? new Decimal(input.amountOriginal) : null,
          exchangeRateId: input.exchangeRateId,
          method: input.method as never,
          referenceNumber: input.referenceNumber,
          originBank: input.originBank,
          destBank: input.destBank,
          commissionPct: input.commissionPct ? new Decimal(input.commissionPct) : null,
          igtfAmount: input.igtfAmount ? new Decimal(input.igtfAmount) : null,
          date: input.date,
          notes: input.notes,
          createdBy: input.createdBy,
          idempotencyKey: input.idempotencyKey,
        },
      });

      // Actualizar pendingAmount y paymentStatus en Invoice
      const newPending = currentPending.minus(paymentAmount);
      const newStatus = newPending.isZero() ? "PAID" : "PARTIAL";

      await db.invoice.update({
        where: { id: input.invoiceId },
        data: { pendingAmount: newPending, paymentStatus: newStatus },
      });

      // AuditLog
      await db.auditLog.create({
        data: {
          entityId: payment.id,
          entityName: "InvoicePayment",
          action: "CREATE",
          userId: input.createdBy,
          newValue: {
            invoiceId: input.invoiceId,
            amount: paymentAmount.toFixed(4),
            currency: input.currency,
            method: input.method,
            date: input.date.toISOString(),
            newPendingAmount: newPending.toFixed(4),
            newPaymentStatus: newStatus,
          },
        },
      });

      return {
        id: payment.id,
        invoiceId: payment.invoiceId,
        amount: payment.amount.toString(),
        currency: payment.currency,
        amountOriginal: payment.amountOriginal?.toString() ?? null,
        method: payment.method,
        referenceNumber: payment.referenceNumber,
        igtfAmount: payment.igtfAmount?.toString() ?? null,
        date: payment.date,
        notes: payment.notes,
        createdBy: payment.createdBy,
        createdAt: payment.createdAt,
        idempotencyKey: payment.idempotencyKey,
      };
    };

    if (tx) return run(tx);
    return withRetry(() => prisma.$transaction(run, { isolationLevel: "ReadCommitted" }));
  }

  // ─── Cancelar (soft delete) un pago ─────────────────────────────────────────
  static async cancelPayment(
    paymentId: string,
    companyId: string,
    cancelledBy: string
  ): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        const payment = await tx.invoicePayment.findFirst({
          where: { id: paymentId, companyId, deletedAt: null },
          include: { invoice: { select: { date: true, pendingAmount: true, paymentStatus: true } } },
        });
        if (!payment) throw new Error("Pago no encontrado o ya cancelado");

        // Guard: año fiscal cerrado
        const invoiceYear = payment.invoice.date.getFullYear();
        const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(companyId, invoiceYear);
        if (yearClosed) {
          throw new Error(`El ejercicio económico ${invoiceYear} está cerrado. No se pueden cancelar pagos de ese año`);
        }

        // Revertir pendingAmount
        const currentPending = payment.invoice.pendingAmount
          ? new Decimal(payment.invoice.pendingAmount.toString())
          : new Decimal(0);
        const paymentAmount = new Decimal(payment.amount.toString());
        const newPending = currentPending.plus(paymentAmount);

        // El status vuelve a PARTIAL si había más pagos, UNPAID si era el único
        const remainingPayments = await tx.invoicePayment.count({
          where: { invoiceId: payment.invoiceId, deletedAt: null, id: { not: paymentId } },
        });
        const newStatus = remainingPayments > 0 ? "PARTIAL" : "UNPAID";

        await tx.invoicePayment.update({
          where: { id: paymentId },
          data: { deletedAt: new Date(), deletedBy: cancelledBy },
        });

        await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: { pendingAmount: newPending, paymentStatus: newStatus },
        });

        await tx.auditLog.create({
          data: {
            entityId: paymentId,
            entityName: "InvoicePayment",
            action: "CANCEL",
            userId: cancelledBy,
            oldValue: {
              amount: paymentAmount.toFixed(4),
              method: payment.method,
              date: payment.date.toISOString(),
            },
            newValue: {
              deletedAt: new Date().toISOString(),
              newPendingAmount: newPending.toFixed(4),
              newPaymentStatus: newStatus,
            },
          },
        });
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  // ─── Obtener pagos activos de una factura ────────────────────────────────────
  static async getPaymentsByInvoice(
    invoiceId: string,
    companyId: string
  ): Promise<InvoicePaymentSummary[]> {
    const payments = await prisma.invoicePayment.findMany({
      where: { invoiceId, companyId, deletedAt: null },
      orderBy: { date: "asc" },
    });

    return payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amount: p.amount.toString(),
      currency: p.currency,
      amountOriginal: p.amountOriginal?.toString() ?? null,
      method: p.method,
      referenceNumber: p.referenceNumber,
      igtfAmount: p.igtfAmount?.toString() ?? null,
      date: p.date,
      notes: p.notes,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      idempotencyKey: p.idempotencyKey,
    }));
  }
}
