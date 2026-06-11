import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { Currency, PaymentMethod, type Prisma } from "@prisma/client";
import { FiscalYearCloseService } from "@/modules/fiscal-close/services/FiscalYearCloseService";

export type PaymentRecordSummary = {
  id: string;
  companyId: string;
  invoiceId: string | null;
  method: PaymentMethod;
  amountVes: string;
  currency: Currency;
  amountOriginal: string | null;
  exchangeRateId: string | null;
  referenceNumber: string | null;
  originBank: string | null;
  destBank: string | null;
  senderPhone: string | null;
  destPhone: string | null;
  commissionPct: string | null;
  commissionAmount: string | null;
  igtfAmount: string | null;
  date: Date;
  notes: string | null;
  appliedToInvoice: boolean;
  deletedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  createdBy: string;
};

type CreatePaymentData = {
  companyId: string;
  invoiceId?: string;
  method: PaymentMethod;
  amountVes: Decimal;
  currency: Currency;
  amountOriginal?: Decimal;
  exchangeRateId?: string;
  referenceNumber?: string;
  originBank?: string;
  destBank?: string;
  senderPhone?: string;
  destPhone?: string;
  commissionPct?: Decimal;
  commissionAmount?: Decimal;
  igtfAmount?: Decimal;
  // Riesgo-6 audit: IVA retenido por cliente CE (Prov. 0049 75%/100%)
  ivaRetentionAmount?: Decimal;
  date: Date;
  notes?: string;
  createdBy: string;
  // ADR-030: FK opcional para GL auto-posting
  bankAccountId?: string;
  // ADR-032 F1: true cuando applyPaymentToInvoice decrementó el saldo de la factura
  appliedToInvoice?: boolean;
  // ADR-032 F2: dedupe de doble-submit (vía canónica desde receivables)
  idempotencyKey?: string;
};

function serialize(r: {
  id: string;
  companyId: string;
  invoiceId: string | null;
  method: PaymentMethod;
  amountVes: Decimal;
  currency: Currency;
  amountOriginal: Decimal | null;
  exchangeRateId: string | null;
  referenceNumber: string | null;
  originBank: string | null;
  destBank: string | null;
  senderPhone: string | null;
  destPhone: string | null;
  commissionPct: Decimal | null;
  commissionAmount: Decimal | null;
  igtfAmount: Decimal | null;
  date: Date;
  notes: string | null;
  appliedToInvoice: boolean;
  deletedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  createdBy: string;
}): PaymentRecordSummary {
  return {
    id: r.id,
    companyId: r.companyId,
    invoiceId: r.invoiceId,
    method: r.method,
    amountVes: r.amountVes.toString(),
    currency: r.currency,
    amountOriginal: r.amountOriginal?.toString() ?? null,
    exchangeRateId: r.exchangeRateId,
    referenceNumber: r.referenceNumber,
    originBank: r.originBank,
    destBank: r.destBank,
    senderPhone: r.senderPhone,
    destPhone: r.destPhone,
    commissionPct: r.commissionPct?.toString() ?? null,
    commissionAmount: r.commissionAmount?.toString() ?? null,
    igtfAmount: r.igtfAmount?.toString() ?? null,
    date: r.date,
    notes: r.notes,
    appliedToInvoice: r.appliedToInvoice,
    deletedAt: r.deletedAt,
    voidReason: r.voidReason,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  };
}

export class PaymentService {
  /**
   * Crea un registro de pago dentro de una transacción Prisma.
   */
  static async create(
    tx: typeof prisma,
    input: CreatePaymentData,
  ): Promise<PaymentRecordSummary> {
    const record = await tx.paymentRecord.create({
      data: {
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        method: input.method,
        amountVes: input.amountVes,
        currency: input.currency,
        amountOriginal: input.amountOriginal,
        exchangeRateId: input.exchangeRateId,
        referenceNumber: input.referenceNumber,
        originBank: input.originBank,
        destBank: input.destBank,
        senderPhone: input.senderPhone,
        destPhone: input.destPhone,
        commissionPct: input.commissionPct,
        commissionAmount: input.commissionAmount,
        igtfAmount: input.igtfAmount,
        ivaRetentionAmount: input.ivaRetentionAmount,
        date: input.date,
        notes: input.notes,
        createdBy: input.createdBy,
        bankAccountId: input.bankAccountId,
        // ADR-032 F1: marca los pagos que decrementaron el saldo de la factura
        appliedToInvoice: input.appliedToInvoice ?? false,
        // ADR-032 F2: dedupe de doble-submit
        idempotencyKey: input.idempotencyKey,
      },
    });
    return serialize(record);
  }

  /**
   * Lista los pagos no anulados de una empresa ordenados por fecha descendente.
   */
  static async list(companyId: string, limit = 50): Promise<PaymentRecordSummary[]> {
    const records = await prisma.paymentRecord.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return records.map(serialize);
  }

  /**
   * Anula un pago: soft-delete + motivo. #14
   */
  static async void(
    tx: typeof prisma,
    paymentId: string,
    companyId: string,
    voidReason: string,
  ): Promise<PaymentRecordSummary> {
    const now = new Date();
    const record = await tx.paymentRecord.update({
      where: { id: paymentId, companyId },
      data: { deletedAt: now, voidReason },
    });
    return serialize(record);
  }

  /**
   * ADR-032 F1: aplica un pago al saldo de la factura vinculada.
   * DEBE llamarse DENTRO del mismo $transaction que crea el PaymentRecord.
   *
   * Concurrencia: SELECT ... FOR UPDATE sobre la fila Invoice serializa las
   * actualizaciones de saldo bajo ReadCommitted (mismo patrón que el lock de
   * InventoryItem en InvoiceLineService) — elimina el lost update de pagos
   * concurrentes sobre la misma factura.
   */
  static async applyPaymentToInvoice(
    tx: Prisma.TransactionClient,
    companyId: string,
    invoiceId: string,
    amountVes: Decimal,
  ): Promise<{ newPending: Decimal; newStatus: "PAID" | "PARTIAL" }> {
    // Row lock primero — toda lectura de saldo posterior ve el valor serializado
    await tx.$executeRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "companyId" = ${companyId} FOR UPDATE`;

    // Guard multi-tenant: companyId en el where (ADR-004)
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      select: { date: true, paymentStatus: true, pendingAmount: true, totalAmountVes: true },
    });
    if (!invoice) throw new Error("Factura no encontrada o no pertenece a esta empresa");
    if (invoice.paymentStatus === "VOIDED") throw new Error("La factura está anulada");
    if (invoice.paymentStatus === "PAID") throw new Error("La factura ya está completamente pagada");

    // Guard: año fiscal cerrado (paridad con ReceivableService.recordPayment)
    const invoiceYear = invoice.date.getFullYear();
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(companyId, invoiceYear);
    if (yearClosed) {
      throw new Error(
        `El ejercicio económico ${invoiceYear} está cerrado. No se pueden registrar pagos en facturas de ese año`,
      );
    }

    const currentPending = invoice.pendingAmount
      ? new Decimal(invoice.pendingAmount.toString())
      : invoice.totalAmountVes
        ? new Decimal(invoice.totalAmountVes.toString())
        : new Decimal(0);

    if (amountVes.greaterThan(currentPending)) {
      throw new Error("El monto del pago excede el saldo pendiente de la factura");
    }

    const newPending = currentPending.minus(amountVes);
    const newStatus = newPending.isZero() ? ("PAID" as const) : ("PARTIAL" as const);

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { pendingAmount: newPending, paymentStatus: newStatus },
    });

    return { newPending, newStatus };
  }

  /**
   * ADR-032 F1: revierte el efecto de un pago anulado sobre el saldo de la factura.
   * Solo debe invocarse para PaymentRecord con appliedToInvoice = true — los
   * registros legacy (pre-ADR-032) nunca decrementaron saldo y restaurarlo
   * corrompería la cartera.
   */
  static async revertPaymentFromInvoice(
    tx: Prisma.TransactionClient,
    companyId: string,
    invoiceId: string,
    paymentRecordId: string,
    amountVes: Decimal,
  ): Promise<void> {
    await tx.$executeRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "companyId" = ${companyId} FOR UPDATE`;

    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { date: true, pendingAmount: true },
    });
    if (!invoice) throw new Error("Factura no encontrada o no pertenece a esta empresa");

    // Guard: año fiscal cerrado (paridad con ReceivableService.cancelPayment)
    const invoiceYear = invoice.date.getFullYear();
    const yearClosed = await FiscalYearCloseService.isFiscalYearClosed(companyId, invoiceYear);
    if (yearClosed) {
      throw new Error(
        `El ejercicio económico ${invoiceYear} está cerrado. No se pueden anular pagos de facturas de ese año`,
      );
    }

    const currentPending = invoice.pendingAmount
      ? new Decimal(invoice.pendingAmount.toString())
      : new Decimal(0);
    const newPending = currentPending.plus(amountVes);

    // Status: PARTIAL si quedan otros pagos activos (canónicos o legacy), UNPAID si no
    const remainingCanonical = await tx.paymentRecord.count({
      where: { invoiceId, companyId, deletedAt: null, appliedToInvoice: true, id: { not: paymentRecordId } },
    });
    const remainingLegacy = await tx.invoicePayment.count({
      where: { invoiceId, companyId, deletedAt: null },
    });
    const newStatus = remainingCanonical + remainingLegacy > 0 ? "PARTIAL" : "UNPAID";

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { pendingAmount: newPending, paymentStatus: newStatus },
    });
  }

  /**
   * Calcula el IGTF (3%) sobre un monto VES.
   */
  static calcIgtf(amountVes: Decimal): Decimal {
    return amountVes.mul("0.03").toDecimalPlaces(2);
  }

  /**
   * Calcula el monto de comisión Cashea dado el monto VES y el porcentaje.
   */
  static calcCommission(amountVes: Decimal, pct: Decimal): Decimal {
    return amountVes.mul(pct).div(100).toDecimalPlaces(2);
  }
}
