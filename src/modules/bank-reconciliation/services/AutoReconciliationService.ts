// src/modules/bank-reconciliation/services/AutoReconciliationService.ts
//
// Motor de auto-conciliación bancaria.
// Compara filas del extracto bancario contra InvoicePayment, PaymentRecord
// y Transaction (asientos) del sistema, asignando un score de confianza.
//
// Score: base 100
//   - Diferencia de monto: hasta -40 pts (tolerancia ±1%)
//   - Diferencia de fecha: hasta -30 pts (ventana ±3 días)
//   - Referencia coincide: +20 pts (bonus, cap 100)
//
// Niveles:
//   AUTO      score >= 90
//   SUGGESTED score 70-89
//   MANUAL    score < 70

import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { parseAmount } from "./CsvParserService";
import {
  CONFIDENCE,
  type AutoMatchResult,
  type AutoReconciliationResult,
  type BankStatementRow,
  type ConfidenceLevel,
} from "../schemas/auto-reconciliation.schema";

const DATE_WINDOW_DAYS = 3;
const AMOUNT_TOLERANCE_PCT = 0.01; // 1%

/** Fila bancaria ya parseada (montos como Decimal, fecha como Date) */
type ParsedBankRow = {
  date: Date;
  description: string;
  reference: string | null;
  amount: Decimal;      // siempre positivo
  type: "CREDIT" | "DEBIT";
  raw: BankStatementRow;
};

function parseDate(raw: string): Date {
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (ddmmyyyy) {
    return new Date(
      Date.UTC(
        parseInt(ddmmyyyy[3], 10),
        parseInt(ddmmyyyy[2], 10) - 1,
        parseInt(ddmmyyyy[1], 10)
      )
    );
  }
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (isoDate) {
    return new Date(
      Date.UTC(
        parseInt(isoDate[1], 10),
        parseInt(isoDate[2], 10) - 1,
        parseInt(isoDate[3], 10)
      )
    );
  }
  throw new Error(`Fecha inválida: "${raw}"`);
}

function dateWindow(center: Date, days: number): { from: Date; to: Date } {
  const from = new Date(center);
  from.setUTCDate(from.getUTCDate() - days);
  const to = new Date(center);
  to.setUTCDate(to.getUTCDate() + days);
  return { from, to };
}

function calcScore(
  rowAmount: Decimal,
  candidateAmount: Decimal,
  rowDate: Date,
  candidateDate: Date,
  rowRef: string | null,
  candidateRef: string | null
): number {
  const tolerance = rowAmount.mul(AMOUNT_TOLERANCE_PCT);
  const amountDiff = rowAmount.minus(candidateAmount).abs();

  if (amountDiff.greaterThan(tolerance)) return 0; // fuera de tolerancia

  const amountPenalty = tolerance.isZero()
    ? 0
    : amountDiff.div(tolerance).toNumber() * 40;

  const deltaDays =
    Math.abs(rowDate.getTime() - candidateDate.getTime()) / (1000 * 60 * 60 * 24);

  if (deltaDays > DATE_WINDOW_DAYS) return 0; // fuera de ventana

  const datePenalty = (deltaDays / DATE_WINDOW_DAYS) * 30;

  let score = Math.round(100 - amountPenalty - datePenalty);

  // Bonus de referencia (+20, cap 100)
  if (
    rowRef &&
    candidateRef &&
    (rowRef.includes(candidateRef) || candidateRef.includes(rowRef))
  ) {
    score = Math.min(100, score + 20);
  }

  return Math.max(0, score);
}

function buildReason(
  score: number,
  amountDiff: Decimal,
  deltaDays: number,
  hasRefBonus: boolean
): string {
  if (score === 0) return "Sin coincidencia en el sistema";
  if (score >= CONFIDENCE.AUTO && amountDiff.isZero() && deltaDays === 0) {
    return hasRefBonus ? "Monto exacto, referencia coincide" : "Monto exacto, fecha exacta";
  }
  if (score >= CONFIDENCE.AUTO) {
    return "Monto exacto, referencia coincide";
  }
  return `Monto aproximado (${amountDiff.toFixed(2)} VES de diferencia), ${Math.round(deltaDays)} día(s) de diferencia`;
}

function toConfidence(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE.AUTO) return "AUTO";
  if (score >= CONFIDENCE.SUGGESTED) return "SUGGESTED";
  return "MANUAL";
}

export const AutoReconciliationService = {
  /**
   * Verifica si el período tiene transacciones registradas en el sistema.
   * Revisa InvoicePayment, PaymentRecord y Transaction POSTED.
   */
  async periodHasTransactions(
    companyId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<boolean> {
    const [invoiceCount, paymentCount, txCount] = await Promise.all([
      prisma.invoicePayment.count({
        where: {
          companyId,
          deletedAt: null,
          date: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.paymentRecord.count({
        where: {
          companyId,
          date: { gte: periodStart, lte: periodEnd },
        },
      }),
      prisma.transaction.count({
        where: {
          companyId,
          status: "POSTED",
          date: { gte: periodStart, lte: periodEnd },
        },
      }),
    ]);

    return invoiceCount > 0 || paymentCount > 0 || txCount > 0;
  },

  /**
   * Ejecuta la auto-conciliación sobre un conjunto de filas de extracto bancario.
   * Devuelve el resultado particionado en auto/sugerido/sin conciliar.
   * NO escribe en la base de datos — solo analiza.
   */
  async run(
    companyId: string,
    bankRows: BankStatementRow[],
    periodStart: Date,
    periodEnd: Date
  ): Promise<AutoReconciliationResult> {
    const periodHasData = await AutoReconciliationService.periodHasTransactions(
      companyId,
      periodStart,
      periodEnd
    );

    if (!periodHasData) {
      return {
        auto: [],
        suggested: [],
        unmatched: [],
        periodHasData: false,
        totalRows: bankRows.length,
      };
    }

    // Parsear filas crudas → ParsedBankRow
    const parsed: ParsedBankRow[] = [];
    for (const row of bankRows) {
      let date: Date;
      try {
        date = parseDate(row.date);
      } catch {
        continue; // fila con fecha inválida → skip
      }

      const rawAmount = row.debit ?? row.credit ?? null;
      if (!rawAmount) continue;

      const amountDecimal = parseAmount(rawAmount);
      if (!amountDecimal) continue;

      parsed.push({
        date,
        description: row.description,
        reference: row.reference,
        amount: amountDecimal.abs(),
        type: row.credit ? "CREDIT" : "DEBIT",
        raw: row,
      });
    }

    // Puntuar cada fila en serie para no saturar el pool de conexiones Neon
    const results: AutoMatchResult[] = [];
    for (const row of parsed) {
      const match = await AutoReconciliationService._scoreRow(companyId, row);
      results.push(match);
    }

    const auto = results.filter((r) => r.confidence === "AUTO");
    const suggested = results.filter((r) => r.confidence === "SUGGESTED");
    const unmatched = results.filter((r) => r.confidence === "MANUAL");

    return {
      auto,
      suggested,
      unmatched,
      periodHasData: true,
      totalRows: parsed.length,
    };
  },

  /** @internal — puntúa una fila contra todos los candidatos posibles */
  async _scoreRow(companyId: string, row: ParsedBankRow): Promise<AutoMatchResult> {
    const { from, to } = dateWindow(row.date, DATE_WINDOW_DAYS);

    type Candidate = {
      id: string;
      amount: Decimal;
      date: Date;
      referenceNumber: string | null;
      label: string;
      matchType: "INVOICE_PAYMENT" | "JOURNAL_ENTRY" | "PAYMENT_RECORD";
    };

    const candidates: Candidate[] = [];

    // 1. InvoicePayment
    const invoicePayments = await prisma.invoicePayment.findMany({
      where: {
        companyId,
        deletedAt: null,
        date: { gte: from, lte: to },
        bankTransactions: { none: {} },
      },
      select: {
        id: true,
        amount: true,
        date: true,
        referenceNumber: true,
        invoice: { select: { invoiceNumber: true, counterpartName: true } },
      },
    });

    for (const p of invoicePayments) {
      candidates.push({
        id: p.id,
        amount: new Decimal(p.amount.toString()),
        date: new Date(p.date),
        referenceNumber: p.referenceNumber,
        label: `Factura ${p.invoice?.invoiceNumber ?? ""} — ${p.invoice?.counterpartName ?? ""}`.trim(),
        matchType: "INVOICE_PAYMENT",
      });
    }

    // 2. PaymentRecord
    const paymentRecords = await prisma.paymentRecord.findMany({
      where: {
        companyId,
        date: { gte: from, lte: to },
        bankTransactions: { none: {} },
      },
      select: {
        id: true,
        amountVes: true,
        date: true,
        referenceNumber: true,
        method: true,
      },
    });

    for (const r of paymentRecords) {
      candidates.push({
        id: r.id,
        amount: new Decimal(r.amountVes.toString()),
        date: new Date(r.date),
        referenceNumber: r.referenceNumber,
        label: `Pago ${r.method}${r.referenceNumber ? ` ref: ${r.referenceNumber}` : ""}`,
        matchType: "PAYMENT_RECORD",
      });
    }

    // 3. Transaction (asientos contables) — la query trae entries para calcular monto
    const transactions = await prisma.transaction.findMany({
      where: {
        companyId,
        status: "POSTED",
        date: { gte: from, lte: to },
        bankTransactionMatches: { none: {} },
      },
      select: {
        id: true,
        date: true,
        number: true,
        description: true,
        entries: { select: { amount: true } },
      },
    });

    for (const t of transactions) {
      // Monto del asiento = suma de los débitos (lado positivo)
      const debitSum = t.entries.reduce((acc, e) => {
        const v = new Decimal(e.amount.toString());
        return v.greaterThan(0) ? acc.plus(v) : acc;
      }, new Decimal(0));

      if (debitSum.isZero()) continue;

      candidates.push({
        id: t.id,
        amount: debitSum,
        date: new Date(t.date),
        referenceNumber: null,
        label: `Asiento ${t.number} — ${t.description}`,
        matchType: "JOURNAL_ENTRY",
      });
    }

    // Puntuar todos los candidatos y elegir el mejor
    let bestScore = 0;
    let bestCandidate: Candidate | null = null;

    for (const c of candidates) {
      const score = calcScore(
        row.amount,
        c.amount,
        row.date,
        c.date,
        row.reference,
        c.referenceNumber
      );
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = c;
      }
    }

    if (!bestCandidate || bestScore === 0) {
      return {
        date: row.raw.date,
        description: row.description,
        reference: row.reference,
        amount: row.amount.toFixed(4),
        type: row.type,
        confidence: "MANUAL",
        score: 0,
        matchType: null,
        matchId: null,
        matchLabel: null,
        matchAmount: null,
        reason: "Sin coincidencia en el sistema",
      };
    }

    const amountDiff = row.amount.minus(bestCandidate.amount).abs();
    const deltaDays =
      Math.abs(row.date.getTime() - bestCandidate.date.getTime()) / (1000 * 60 * 60 * 24);
    const hasRefBonus =
      !!row.reference &&
      !!bestCandidate.referenceNumber &&
      (row.reference.includes(bestCandidate.referenceNumber) ||
        bestCandidate.referenceNumber.includes(row.reference));

    return {
      date: row.raw.date,
      description: row.description,
      reference: row.reference,
      amount: row.amount.toFixed(4),
      type: row.type,
      confidence: toConfidence(bestScore),
      score: bestScore,
      matchType: bestCandidate.matchType,
      matchId: bestCandidate.id,
      matchLabel: bestCandidate.label,
      matchAmount: bestCandidate.amount.toFixed(4),
      reason: buildReason(bestScore, amountDiff, deltaDays, hasRefBonus),
    };
  },
};
