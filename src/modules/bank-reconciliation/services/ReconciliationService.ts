// src/modules/bank-reconciliation/services/ReconciliationService.ts
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";

export type ReconciliationCandidate = {
  paymentId: string;
  score: number;
  amountDiff: string;     // diferencia de monto (Decimal string, 4 decimales)
  dateDeltaDays: number;  // diferencia de días entre banco y pago
  amount: string;
  currency: string;
  method: string;
  date: Date;
  referenceNumber: string | null;
};

type FindMatchOptions = {
  amountTolerance?: string; // default "0.01" VES
  dateDeltaDays?: number;   // default 3 días
};

export const ReconciliationService = {
  /**
   * Busca pagos (InvoicePayment) que puedan conciliar con una transacción bancaria.
   * Criterio: monto dentro de tolerancia Y fecha dentro de ventana.
   * Resultados ordenados por score descendente (monto exacto + fecha más cercana = mayor score).
   *
   * Cumple ADR-004: verifica companyId de bankTransaction antes de buscar.
   */
  async findMatchCandidates(
    bankTransactionId: string,
    companyId: string,
    options?: FindMatchOptions
  ): Promise<ReconciliationCandidate[]> {
    const amountTolerance = new Decimal(options?.amountTolerance ?? "0.01");
    const dateDeltaDays = options?.dateDeltaDays ?? 3;

    // Cargar la transacción bancaria con scope tenant
    const bankTx = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: {
        statement: {
          include: { bankAccount: { select: { companyId: true } } },
        },
      },
    });

    if (!bankTx || bankTx.statement.bankAccount.companyId !== companyId) {
      throw new Error("Transacción bancaria no encontrada o sin permisos");
    }

    const txAmount = new Decimal(bankTx.amount.toString());
    const txDate = bankTx.date;

    // Ventana de fechas
    const dateFrom = new Date(txDate);
    dateFrom.setDate(dateFrom.getDate() - dateDeltaDays);
    const dateTo = new Date(txDate);
    dateTo.setDate(dateTo.getDate() + dateDeltaDays);

    // Buscar pagos de la empresa dentro de la ventana de fechas que aún no estén conciliados
    const payments = await prisma.invoicePayment.findMany({
      where: {
        companyId,
        deletedAt: null,
        date: { gte: dateFrom, lte: dateTo },
        // Solo pagos no vinculados a ninguna bankTransaction
        bankTransactions: { none: {} },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        method: true,
        date: true,
        referenceNumber: true,
      },
    });

    // Filtrar por tolerancia de monto y ventana de fecha (client-side defense-in-depth)
    const candidates: ReconciliationCandidate[] = [];

    for (const payment of payments) {
      const payAmount = new Decimal(payment.amount.toString());
      const amountDiff = txAmount.minus(payAmount).abs();

      if (amountDiff.greaterThan(amountTolerance)) continue;

      // Verificar ventana de fecha en el cliente (la query Prisma ya filtra, pero doble check)
      const payDate = new Date(payment.date);
      const actualDeltaDaysRaw = Math.abs(
        (txDate.getTime() - payDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (actualDeltaDaysRaw > dateDeltaDays) continue;

      // Score: base 100, penalizar por diferencia de monto y por días de diferencia
      // Monto exacto → sin penalización. Máximo drift = amountTolerance → -40 puntos.
      // Fecha exacta → sin penalización. Máximo drift = dateDeltaDays → -30 puntos.
      const actualDeltaDays = actualDeltaDaysRaw;

      const amountPenalty = amountTolerance.isZero()
        ? 0
        : amountDiff.div(amountTolerance).toNumber() * 40;
      const datePenalty = dateDeltaDays === 0
        ? 0
        : (actualDeltaDays / dateDeltaDays) * 30;

      const score = Math.round(100 - amountPenalty - datePenalty);

      candidates.push({
        paymentId: payment.id,
        score,
        amountDiff: amountDiff.toFixed(4),
        dateDeltaDays: Math.round(actualDeltaDays),
        amount: payAmount.toFixed(4),
        currency: payment.currency,
        method: payment.method,
        date: new Date(payment.date),
        referenceNumber: payment.referenceNumber,
      });
    }

    // Ordenar por score descendente
    return candidates.sort((a, b) => b.score - a.score);
  },

  /**
   * Retorna el candidato con mayor score, o null si no hay candidatos.
   * Convenience wrapper sobre findMatchCandidates.
   */
  async getSuggestedMatch(
    bankTransactionId: string,
    companyId: string,
    options?: FindMatchOptions
  ): Promise<ReconciliationCandidate | null> {
    const candidates = await ReconciliationService.findMatchCandidates(
      bankTransactionId,
      companyId,
      options
    );
    return candidates[0] ?? null;
  },
};
