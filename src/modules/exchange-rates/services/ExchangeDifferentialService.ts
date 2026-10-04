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
import { normalizeRifOrNull } from "@/lib/tax-config";
import { batchResolvePartyIdsByRif } from "@/lib/party-resolver";
import { assertBalancedGLEntries, quantizeGLEntries } from "@/lib/gl-assertions";

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
  // ADR-054: tercero de la factura — vínculo directo (Invoice.customerId/vendorId) si
  // existe, si no por RIF en el catálogo (resuelto en calculate()). Sin esto, la línea CxC/
  // CxP agregada de la revaluación quedaría sin tercero y bloquearía el posting en cuanto
  // arAccountId/apAccountId se marque Account.requiresThirdParty.
  customerId?: string;
  vendorId?: string;
}

/** Movimiento neto de una cuenta pote (CxC o CxP) atribuido a UN tercero — `partyId`
 * undefined agrupa las líneas sin tercero resuelto (no se descartan, solo quedan sin
 * atribuir; el gate decide si eso bloquea el posting). */
export interface FxPartyMovement {
  partyId?: string;
  netMovement: Decimal;
}

export interface FxDiffSummary {
  lines: FxDiffLine[];
  netCxCMovement: Decimal;
  netCxPMovement: Decimal;
  totalFxGain: Decimal;
  totalFxLoss: Decimal;
  // ADR-054: desglose por tercero — post() postea UNA línea por cliente/proveedor en vez
  // de un neto agregado sin dueño. netCxCMovement/netCxPMovement se conservan (totales
  // para el preview en UI), pero post() usa este desglose para las líneas reales.
  cxcByParty: FxPartyMovement[];
  cxpByParty: FxPartyMovement[];
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

    // ADR-054: resolver el tercero de cada factura (customerId para SALE, vendorId para
    // PURCHASE) ANTES de armar las líneas — vínculo directo si existe, si no por RIF, en
    // UNA sola query batch por tipo (mismo patrón que PaymentGLService.postPaymentBatchGL,
    // evita N+1 en empresas con muchos clientes/proveedores en divisas).
    const customerRifsNeeded = invoices
      .filter((inv) => inv.type === "SALE" && !inv.customerId)
      .map((inv) => normalizeRifOrNull(inv.counterpartRif))
      .filter((rif): rif is string => !!rif);
    const vendorRifsNeeded = invoices
      .filter((inv) => inv.type === "PURCHASE" && !inv.vendorId)
      .map((inv) => normalizeRifOrNull(inv.counterpartRif))
      .filter((rif): rif is string => !!rif);
    const [customerIdByRif, vendorIdByRif] = await Promise.all([
      batchResolvePartyIdsByRif(db, companyId, "customer", customerRifsNeeded),
      batchResolvePartyIdsByRif(db, companyId, "vendor", vendorRifsNeeded),
    ]);

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
          paidForeign = paidForeign.plus(new Decimal(ip.amount.toString()).dividedBy(originalRate));
        }
      }

      const outstandingForeign = totalForeign.minus(paidForeign).toDecimalPlaces(6);
      if (outstandingForeign.lessThanOrEqualTo(0)) continue;

      // ADR-058: los montos en Bs. se redondean a 2 decimales (HALF_UP) en el ORIGEN; el
      // diferencial es la resta de dos montos ya a 2 decimales, así que es exacto (múltiplo de
      // 0,01) y cada par línea/contrapartida del asiento cuadra sin residuo. Las tasas y la
      // cantidad en divisa (6 dec.) son factores y no se redondean aquí.
      const vesAtOriginal = outstandingForeign
        .times(originalRate)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const vesAtReval = outstandingForeign
        .times(revalRate)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const differential = vesAtReval.minus(vesAtOriginal);

      if (differential.isZero()) continue;

      const normalizedRif = normalizeRifOrNull(inv.counterpartRif);
      const customerId =
        inv.type === "SALE"
          ? (inv.customerId ?? (normalizedRif ? customerIdByRif.get(normalizedRif) : undefined))
          : undefined;
      const vendorId =
        inv.type === "PURCHASE"
          ? (inv.vendorId ?? (normalizedRif ? vendorIdByRif.get(normalizedRif) : undefined))
          : undefined;

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
        customerId: customerId ?? undefined,
        vendorId: vendorId ?? undefined,
      });
    }

    return ExchangeDifferentialService.aggregate(lines);
  }

  static aggregate(lines: FxDiffLine[]): FxDiffSummary {
    let saleGain = new Decimal(0);
    let saleLoss = new Decimal(0);
    let purchaseGain = new Decimal(0);
    let purchaseLoss = new Decimal(0);

    // ADR-054: movimiento neto por tercero — la clave "" agrupa las líneas sin tercero
    // resuelto (no se descartan, solo quedan sin atribuir hasta que el gate decida).
    const NO_PARTY = "";
    const cxcByCustomer = new Map<string, Decimal>();
    const cxpByVendor = new Map<string, Decimal>();

    for (const line of lines) {
      if (line.invoiceType === "SALE") {
        if (line.differential.greaterThan(0)) {
          saleGain = saleGain.plus(line.differential);
        } else {
          saleLoss = saleLoss.plus(line.differential.abs());
        }
        const key = line.customerId ?? NO_PARTY;
        cxcByCustomer.set(key, (cxcByCustomer.get(key) ?? new Decimal(0)).plus(line.differential));
      } else {
        // PURCHASE: diff > 0 = we owe more VES = loss
        if (line.differential.greaterThan(0)) {
          purchaseLoss = purchaseLoss.plus(line.differential);
        } else {
          purchaseGain = purchaseGain.plus(line.differential.abs());
        }
        const key = line.vendorId ?? NO_PARTY;
        cxpByVendor.set(key, (cxpByVendor.get(key) ?? new Decimal(0)).plus(line.differential));
      }
    }

    // netCxCMovement > 0 = CxC increases (Dr)
    // netCxPMovement > 0 = CxP increases (Cr in liability terms)
    const netCxCMovement = saleGain.minus(saleLoss);
    const netCxPMovement = purchaseLoss.minus(purchaseGain);
    const totalFxGain = saleGain.plus(purchaseGain);
    const totalFxLoss = saleLoss.plus(purchaseLoss);

    const toPartyMovements = (byParty: Map<string, Decimal>): FxPartyMovement[] =>
      [...byParty.entries()].map(([key, netMovement]) => ({
        partyId: key === NO_PARTY ? undefined : key,
        netMovement,
      }));

    return {
      lines,
      netCxCMovement,
      netCxPMovement,
      totalFxGain,
      totalFxLoss,
      cxcByParty: toPartyMovements(cxcByCustomer),
      cxpByParty: toPartyMovements(cxpByVendor),
    };
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

    const mm = String(revaluationDate.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = revaluationDate.getUTCFullYear();
    const desc = `Revaluación diferencial cambiario ${mm}/${yyyy} (NIC 21)`;

    const rawEntries: Array<{
      accountId: string;
      amount: Decimal;
      description: string;
      customerId?: string;
      vendorId?: string;
      noAbsorb?: boolean;
    }> = [];

    // ADR-054: una línea CxC por CLIENTE (no un neto agregado sin tercero) — necesario para
    // no bloquear la revaluación si arAccountId se marca requiresThirdParty. La suma de estas
    // líneas es exactamente netCxCMovement (los grupos particionan todas las líneas SALE).
    for (const { partyId, netMovement } of summary.cxcByParty) {
      if (netMovement.isZero()) continue;
      rawEntries.push({
        accountId: config.arAccountId,
        amount: netMovement,
        description: `${desc} — CxC`,
        customerId: partyId,
        noAbsorb: true, // auxiliar de CxC (tercero)
      });
    }

    // Misma idea para CxP: una línea por PROVEEDOR en vez del neto agregado.
    for (const { partyId, netMovement } of summary.cxpByParty) {
      if (netMovement.isZero()) continue;
      // CxP is a liability: movement > 0 means liability increases = Credit (negative)
      rawEntries.push({
        accountId: config.apAccountId,
        amount: netMovement.negated(),
        description: `${desc} — CxP`,
        vendorId: partyId,
        noAbsorb: true, // auxiliar de CxP (tercero)
      });
    }

    if (summary.totalFxGain.greaterThan(0)) {
      rawEntries.push({
        accountId: config.fxGainAccountId,
        amount: summary.totalFxGain.negated(), // income = Credit
        description: `${desc} — ganancia cambiaria`,
      });
    }

    if (summary.totalFxLoss.greaterThan(0)) {
      rawEntries.push({
        accountId: config.fxLossAccountId,
        amount: summary.totalFxLoss, // expense = Debit
        description: `${desc} — pérdida cambiaria`,
      });
    }

    // ADR-058: cuantizar al céntimo ANTES de verificar y de persistir. Con el origen ya a
    // 2 decimales no hay residuo; si lo hubiera, solo puede absorberse en ganancia/pérdida
    // cambiaria (las líneas CxC/CxP son auxiliares de tercero, noAbsorb).
    const { entries } = quantizeGLEntries(rawEntries);
    // N4: invariante de partida doble
    assertBalancedGLEntries(entries);

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
            customerId: e.customerId,
            vendorId: e.vendorId,
          })),
        },
      },
      select: { id: true },
    });

    return glTx.id;
  }
}
