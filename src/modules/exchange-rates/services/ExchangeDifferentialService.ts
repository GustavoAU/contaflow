// src/modules/exchange-rates/services/ExchangeDifferentialService.ts
//
// ADR-027: Revaluación de saldos en moneda extranjera (NIC 21 / VEN-NIF BA-5).
//
// Convención JournalEntry: positivo = Débito, negativo = Crédito.
//
// VENTA (CxC en USD):  tasa sube → Dr CxC / Cr Ganancia Cambiaria
//                       tasa baja → Dr Pérdida Cambiaria / Cr CxC
// COMPRA (CxP en USD): tasa sube → Dr Pérdida Cambiaria / Cr CxP
//                       tasa baja → Dr CxP / Cr Ganancia Cambiaria
//
// Invariante GL: netCxC + netCxP(negado) + fxGain(negado) + fxLoss = 0

import { Decimal } from "decimal.js";
import type { Prisma } from "@prisma/client";

export interface FxDiffLine {
  invoiceId: string;
  invoiceNumber: string;
  invoiceType: "SALE" | "PURCHASE";
  currency: string;
  outstandingForeign: Decimal;
  originalRate: Decimal;
  revalRate: Decimal;
  vesAtOriginal: Decimal;
  vesAtReval: Decimal;
  differential: Decimal;
}

export interface FxDiffSummary {
  lines: FxDiffLine[];
  netCxCMovement: Decimal;
  netCxPMovement: Decimal;
  totalFxGain: Decimal;
  totalFxLoss: Decimal;
}

export interface FxGLConfig {
  arAccountId: string;
  apAccountId: string;
  fxGainAccountId: string;
  fxLossAccountId: string;
}

export class ExchangeDifferentialService {
  static async calculate(
    companyId: string,
    currency: "USD" | "EUR",
    revalRate: Decimal,
    db: Prisma.TransactionClient
  ): Promise<FxDiffSummary> {
    const invoices = await db.invoice.findMany({
      where: {
        companyId,
        currency,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        deletedAt: null,
        exchangeRateId: { not: null },
      },
      include: {
        exchangeRate: { select: { rate: true } },
        invoicePayments: {
          where: { deletedAt: null },
          select: { amount: true, amountOriginal: true },
        },
      },
    });

    const lines: FxDiffLine[] = [];

    for (const inv of invoices) {
      if (!inv.exchangeRate || !inv.totalAmountVes) continue;

      const originalRate = new Decimal(inv.exchangeRate.rate.toString());
      if (originalRate.isZero()) continue;

      const totalVes = new Decimal(inv.totalAmountVes.toString());
      const totalForeign = totalVes.dividedBy(originalRate);

      // Sum paid foreign amounts; approximate VES-denominated payments at original rate
      let paidForeign = new Decimal(0);
      for (const ip of inv.invoicePayments) {
        if (ip.amountOriginal) {
          paidForeign = paidForeign.plus(new Decimal(ip.amountOriginal.toString()));
        } else {
          paidForeign = paidForeign.plus(
            new Decimal(ip.amount.toString()).dividedBy(originalRate)
          );
        }
      }

      const outstandingForeign = totalForeign.minus(paidForeign).toDecimalPlaces(6);
      if (outstandingForeign.lessThanOrEqualTo(0)) continue;

      const vesAtOriginal = outstandingForeign.times(originalRate).toDecimalPlaces(4);
      const vesAtReval = outstandingForeign.times(revalRate).toDecimalPlaces(4);
      const differential = vesAtReval.minus(vesAtOriginal).toDecimalPlaces(4);

      if (differential.isZero()) continue;

      lines.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceType: inv.type as "SALE" | "PURCHASE",
        currency,
        outstandingForeign,
        originalRate: originalRate.toDecimalPlaces(4),
        revalRate: revalRate.toDecimalPlaces(4),
        vesAtOriginal,
        vesAtReval,
        differential,
      });
    }

    return ExchangeDifferentialService.aggregate(lines);
  }

  static aggregate(lines: FxDiffLine[]): FxDiffSummary {
    let saleGain = new Decimal(0);
    let saleLoss = new Decimal(0);
    let purchaseGain = new Decimal(0);
    let purchaseLoss = new Decimal(0);

    for (const line of lines) {
      if (line.invoiceType === "SALE") {
        if (line.differential.greaterThan(0)) {
          saleGain = saleGain.plus(line.differential);
        } else {
          saleLoss = saleLoss.plus(line.differential.abs());
        }
      } else {
        // PURCHASE: diff > 0 = we owe more VES = loss
        if (line.differential.greaterThan(0)) {
          purchaseLoss = purchaseLoss.plus(line.differential);
        } else {
          purchaseGain = purchaseGain.plus(line.differential.abs());
        }
      }
    }

    // netCxCMovement > 0 = CxC increases (Dr)
    // netCxPMovement > 0 = CxP increases (Cr in liability terms)
    const netCxCMovement = saleGain.minus(saleLoss);
    const netCxPMovement = purchaseLoss.minus(purchaseGain);
    const totalFxGain = saleGain.plus(purchaseGain);
    const totalFxLoss = saleLoss.plus(purchaseLoss);

    return { lines, netCxCMovement, netCxPMovement, totalFxGain, totalFxLoss };
  }

  static async post(
    summary: FxDiffSummary,
    config: FxGLConfig,
    companyId: string,
    userId: string,
    revaluationDate: Date,
    periodId: string | undefined,
    db: Prisma.TransactionClient
  ): Promise<string> {
    if (summary.totalFxGain.isZero() && summary.totalFxLoss.isZero()) {
      throw new Error("No hay diferencial cambiario que registrar.");
    }

    const mm = String(revaluationDate.getMonth() + 1).padStart(2, "0");
    const yyyy = revaluationDate.getFullYear();
    const desc = `Revaluación diferencial cambiario ${mm}/${yyyy} (NIC 21)`;

    const entries: Array<{ accountId: string; amount: Decimal; description: string }> = [];

    if (!summary.netCxCMovement.isZero()) {
      entries.push({
        accountId: config.arAccountId,
        amount: summary.netCxCMovement,
        description: `${desc} — CxC`,
      });
    }

    if (!summary.netCxPMovement.isZero()) {
      // CxP is a liability: movement > 0 means liability increases = Credit (negative)
      entries.push({
        accountId: config.apAccountId,
        amount: summary.netCxPMovement.negated(),
        description: `${desc} — CxP`,
      });
    }

    if (summary.totalFxGain.greaterThan(0)) {
      entries.push({
        accountId: config.fxGainAccountId,
        amount: summary.totalFxGain.negated(), // income = Credit
        description: `${desc} — ganancia cambiaria`,
      });
    }

    if (summary.totalFxLoss.greaterThan(0)) {
      entries.push({
        accountId: config.fxLossAccountId,
        amount: summary.totalFxLoss, // expense = Debit
        description: `${desc} — pérdida cambiaria`,
      });
    }

    const glTx = await db.transaction.create({
      data: {
        companyId,
        number: `FX-REVAL-${yyyy}${mm}`,
        date: revaluationDate,
        description: desc,
        userId,
        periodId,
        type: "AJUSTE",
        entries: {
          create: entries.map((e) => ({
            accountId: e.accountId,
            amount: e.amount,
            description: e.description,
          })),
        },
      },
      select: { id: true },
    });

    return glTx.id;
  }
}
