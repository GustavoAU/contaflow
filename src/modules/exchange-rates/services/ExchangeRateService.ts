import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import { Currency } from "@prisma/client";

export type ExchangeRateSummary = {
  id: string;
  currency: Currency;
  rate: string;
  date: Date;
  source: string;
  createdAt: Date;
  createdBy: string;
};

export class ExchangeRateService {
  /**
   * Upsert: si ya existe tasa para (companyId, currency, date) la actualiza,
   * si no la crea. Retorna el registro resultante.
   */
  static async upsert(
    tx: typeof prisma,
    companyId: string,
    currency: Currency,
    date: Date,
    rate: Decimal,
    source: string,
    createdBy: string,
  ): Promise<ExchangeRateSummary> {
    const record = await tx.exchangeRate.upsert({
      where: { companyId_currency_date: { companyId, currency, date } },
      update: { rate, source },
      create: { companyId, currency, rate, date, source, createdBy },
    });
    return { ...record, rate: record.rate.toString() };
  }

  /**
   * Devuelve la tasa exacta para una fecha dada.
   * Lanza error si no existe (bloqueo contable).
   */
  static async getRateForDate(
    companyId: string,
    currency: Currency,
    date: Date,
  ): Promise<ExchangeRateSummary> {
    const record = await prisma.exchangeRate.findUnique({
      where: { companyId_currency_date: { companyId, currency, date } },
    });
    if (!record) {
      const dateStr = date.toISOString().split("T")[0];
      throw new Error(
        `No hay tasa BCV registrada para ${currency} el ${dateStr}. Ingrese la tasa antes de registrar la transacción.`,
      );
    }
    return { ...record, rate: record.rate.toString() };
  }

  /**
   * Devuelve la tasa más reciente disponible para la moneda.
   * Útil para precompletar el formulario.
   */
  static async getLatestRate(
    companyId: string,
    currency: Currency,
  ): Promise<ExchangeRateSummary | null> {
    const record = await prisma.exchangeRate.findFirst({
      where: { companyId, currency },
      orderBy: { date: "desc" },
    });
    if (!record) return null;
    return { ...record, rate: record.rate.toString() };
  }

  /**
   * Lista histórica paginada para la UI.
   */
  static async list(
    companyId: string,
    currency?: Currency,
    limit = 30,
  ): Promise<ExchangeRateSummary[]> {
    const records = await prisma.exchangeRate.findMany({
      where: { companyId, ...(currency ? { currency } : {}) },
      orderBy: [{ date: "desc" }, { currency: "asc" }],
      take: limit,
    });
    return records.map((r) => ({ ...r, rate: r.rate.toString() }));
  }

  /**
   * Convierte un monto en moneda extranjera a VES usando la tasa dada.
   */
  static toVES(amount: Decimal, rate: Decimal): Decimal {
    return amount.mul(rate).toDecimalPlaces(2);
  }
}
