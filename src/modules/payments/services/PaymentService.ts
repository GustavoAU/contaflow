import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { Currency, PaymentMethod } from "@prisma/client";

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
  commissionPct: string | null;
  commissionAmount: string | null;
  igtfAmount: string | null;
  date: Date;
  notes: string | null;
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
  commissionPct?: Decimal;
  commissionAmount?: Decimal;
  igtfAmount?: Decimal;
  date: Date;
  notes?: string;
  createdBy: string;
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
  commissionPct: Decimal | null;
  commissionAmount: Decimal | null;
  igtfAmount: Decimal | null;
  date: Date;
  notes: string | null;
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
    commissionPct: r.commissionPct?.toString() ?? null,
    commissionAmount: r.commissionAmount?.toString() ?? null,
    igtfAmount: r.igtfAmount?.toString() ?? null,
    date: r.date,
    notes: r.notes,
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
        commissionPct: input.commissionPct,
        commissionAmount: input.commissionAmount,
        igtfAmount: input.igtfAmount,
        date: input.date,
        notes: input.notes,
        createdBy: input.createdBy,
      },
    });
    return serialize(record);
  }

  /**
   * Lista los pagos de una empresa ordenados por fecha descendente.
   */
  static async list(companyId: string, limit = 50): Promise<PaymentRecordSummary[]> {
    const records = await prisma.paymentRecord.findMany({
      where: { companyId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return records.map(serialize);
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
