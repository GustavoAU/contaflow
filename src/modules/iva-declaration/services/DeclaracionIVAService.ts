// src/modules/iva-declaration/services/DeclaracionIVAService.ts

import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import type { Forma30Result, SeccionA, SeccionB, SeccionC, SeccionD, SeccionE, TaxLineRow } from "../types/forma30.types";

const ZERO = new Decimal(0);

function zeroRow(): TaxLineRow {
  return { base: ZERO, tax: ZERO };
}

function addRow(acc: TaxLineRow, base: Decimal, tax: Decimal, sign: 1 | -1 = 1): TaxLineRow {
  return {
    base: acc.base.plus(base.times(sign)),
    tax: acc.tax.plus(tax.times(sign)),
  };
}

function vesRate(inv: { currency: string; exchangeRate: { rate: { toString(): string } } | null }): Decimal {
  if (inv.currency === "VES" || !inv.exchangeRate) return new Decimal(1);
  return new Decimal(inv.exchangeRate.rate.toString());
}

export class DeclaracionIVAService {
  /**
   * Calcula la Forma 30 SENIAT para un período mensual.
   *
   * - Isolation level: Read Committed (solo lectura, sin writes).
   * - Si tx no se provee, usa el cliente Prisma singleton.
   * - Facturas con deletedAt != null se excluyen.
   * - Retenciones VOIDED o deletedAt != null se excluyen.
   * - NOTA_CREDITO invierte signo en sección A.
   * - Todos los montos calculados con Decimal.js (ADR-002).
   * - companyId incluido en cada query (ADR-004).
   */
  static async calculate(
    companyId: string,
    year: number,
    month: number,
    tx?: PrismaClient,
    creditoFiscalPeriodoAnterior: Decimal = ZERO
  ): Promise<Forma30Result> {
    const db = tx ?? prisma;

    // Rango del período — primer día del mes (inclusive) al primer día del mes siguiente (exclusive)
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    // ── 1. Company flag ──────────────────────────────────────────────────────
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { isSpecialContributor: true },
    });
    const isSpecialContributor = company?.isSpecialContributor ?? false;

    // ── 2. AccountingPeriod existence check ──────────────────────────────────
    const period = await db.accountingPeriod.findUnique({
      where: { companyId_year_month: { companyId, year, month } },
      select: { id: true },
    });

    // ── 3. Facturas de VENTA ─────────────────────────────────────────────────
    const saleInvoices = await db.invoice.findMany({
      where: {
        companyId,
        type: "SALE",
        date: { gte: periodStart, lt: periodEnd },
        deletedAt: null,
      },
      select: {
        docType: true,
        taxCategory: true,
        ivaRetentionAmount: true,
        currency: true,
        exchangeRate: { select: { rate: true } },
        taxLines: {
          select: { taxType: true, base: true, amount: true },
        },
      },
    });

    // ── 4. Facturas de COMPRA ────────────────────────────────────────────────
    const purchaseInvoices = await db.invoice.findMany({
      where: {
        companyId,
        type: "PURCHASE",
        date: { gte: periodStart, lt: periodEnd },
        deletedAt: null,
      },
      select: {
        docType: true,
        taxCategory: true,
        currency: true,
        exchangeRate: { select: { rate: true } },
        taxLines: {
          select: { taxType: true, base: true, amount: true },
        },
      },
    });

    // ── 5. Retenciones practicadas (solo si isSpecialContributor) ────────────
    const retenciones = isSpecialContributor
      ? await db.retencion.findMany({
          where: {
            companyId,
            invoiceDate: { gte: periodStart, lt: periodEnd },
            status: { not: "VOIDED" },
            deletedAt: null,
          },
          select: { ivaRetention: true },
        })
      : [];

    // ── 6. IGTF del período ──────────────────────────────────────────────────
    const igtfRows = await db.iGTFTransaction.findMany({
      where: {
        companyId,
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      select: { amount: true, igtfAmount: true },
    });

    // ── Calcular Sección A (Débitos Fiscales — Ventas) ───────────────────────
    let aGeneral = zeroRow();
    let aReducida = zeroRow();
    let aAdicionalLujo = zeroRow();
    let aExentasBase = ZERO;
    const aExportacionesBase = ZERO;
    let c1SufriBas = ZERO; // retenciones IVA sufridas

    for (const inv of saleInvoices) {
      // NOTA_CREDITO invierte signo (reduce débitos)
      const sign: 1 | -1 = inv.docType === "NOTA_CREDITO" ? -1 : 1;
      const fx = vesRate(inv);

      // Facturas exentas/exoneradas — capturar la base del subtotal implícita
      if (inv.taxCategory === "EXENTA" || inv.taxCategory === "EXONERADA") {
        for (const tl of inv.taxLines) {
          if (tl.taxType === "EXENTO") {
            aExentasBase = aExentasBase.plus(new Decimal(tl.base.toString()).times(fx).times(sign));
          }
        }
        continue;
      }

      // NO_SUJETA — excluir completamente
      if (inv.taxCategory === "NO_SUJETA") continue;

      for (const tl of inv.taxLines) {
        const base = new Decimal(tl.base.toString()).times(fx);
        const amount = new Decimal(tl.amount.toString()).times(fx);
        switch (tl.taxType) {
          case "IVA_GENERAL":
            aGeneral = addRow(aGeneral, base, amount, sign);
            break;
          case "IVA_REDUCIDO":
            aReducida = addRow(aReducida, base, amount, sign);
            break;
          case "IVA_ADICIONAL":
            aAdicionalLujo = addRow(aAdicionalLujo, base, amount, sign);
            break;
          case "EXENTO":
            aExentasBase = aExentasBase.plus(base.times(sign));
            break;
        }
      }

      // Retenciones IVA sufridas (solo si isSpecialContributor) — ya están en VES
      if (isSpecialContributor && inv.ivaRetentionAmount) {
        c1SufriBas = c1SufriBas.plus(new Decimal(inv.ivaRetentionAmount.toString()).times(sign));
      }
    }

    const seccionA: SeccionA = {
      general: aGeneral,
      reducida: aReducida,
      adicionalLujo: aAdicionalLujo,
      exentasExoneradas: { base: aExentasBase },
      exportaciones: { base: aExportacionesBase },
      totalDebitosFiscales: aGeneral.tax.plus(aReducida.tax).plus(aAdicionalLujo.tax),
    };

    // ── Calcular Sección B (Créditos Fiscales — Compras) ────────────────────
    let bGeneral = zeroRow();
    let bReducida = zeroRow();
    let bAdicionalLujo = zeroRow();
    let bExentasBase = ZERO;
    let bImportaciones = zeroRow();

    for (const inv of purchaseInvoices) {
      // NO_SUJETA — excluir
      if (inv.taxCategory === "NO_SUJETA") continue;

      const fx = vesRate(inv);

      // Importaciones van a B5
      const isImport =
        inv.docType === "PLANILLA_IMPORTACION" || inv.taxCategory === "IMPORTACION";

      for (const tl of inv.taxLines) {
        const base = new Decimal(tl.base.toString()).times(fx);
        const amount = new Decimal(tl.amount.toString()).times(fx);
        if (isImport) {
          bImportaciones = addRow(bImportaciones, base, amount);
        } else {
          switch (tl.taxType) {
            case "IVA_GENERAL":
              bGeneral = addRow(bGeneral, base, amount);
              break;
            case "IVA_REDUCIDO":
              bReducida = addRow(bReducida, base, amount);
              break;
            case "IVA_ADICIONAL":
              bAdicionalLujo = addRow(bAdicionalLujo, base, amount);
              break;
            case "EXENTO":
              bExentasBase = bExentasBase.plus(base);
              break;
          }
        }
      }

      // Facturas exentas/exoneradas sin taxLines
      if (
        (inv.taxCategory === "EXENTA" || inv.taxCategory === "EXONERADA") &&
        inv.taxLines.length === 0
      ) {
        // Sin taxLines → base no declarada; no sumamos nada
      }
    }

    const seccionB: SeccionB = {
      general: bGeneral,
      reducida: bReducida,
      adicionalLujo: bAdicionalLujo,
      exentasExoneradas: { base: bExentasBase },
      importaciones: bImportaciones,
      totalCreditosFiscales: bGeneral.tax
        .plus(bReducida.tax)
        .plus(bAdicionalLujo.tax)
        .plus(bImportaciones.tax),
    };

    // ── Calcular Sección C (Retenciones IVA) ────────────────────────────────
    const c2Practicadas = retenciones.reduce(
      (sum, r) => sum.plus(new Decimal(r.ivaRetention.toString())),
      ZERO
    );

    const seccionC: SeccionC = {
      retencionesIvaSufridas: isSpecialContributor ? c1SufriBas : ZERO,
      retencionesIvaPracticadas: c2Practicadas,
      totalRetenciones: (isSpecialContributor ? c1SufriBas : ZERO).plus(c2Practicadas),
    };

    // ── Calcular Sección D (IGTF) ────────────────────────────────────────────
    let igtfBaseTotal = ZERO;
    let igtfTotal = ZERO;
    for (const row of igtfRows) {
      igtfBaseTotal = igtfBaseTotal.plus(new Decimal(row.amount.toString()));
      igtfTotal = igtfTotal.plus(new Decimal(row.igtfAmount.toString()));
    }

    const seccionD: SeccionD = {
      igtfBase: igtfBaseTotal,
      igtfTotal,
    };

    // ── Calcular Sección E (Cuota o saldo a favor) ───────────────────────────
    const credito = creditoFiscalPeriodoAnterior.lt(ZERO) ? ZERO : creditoFiscalPeriodoAnterior;
    const cuota = seccionA.totalDebitosFiscales
      .minus(seccionB.totalCreditosFiscales)
      .minus(seccionC.totalRetenciones)
      .minus(credito);

    const seccionE: SeccionE = {
      creditoFiscalPeriodoAnterior: credito,
      cuotaPeriodo: cuota,
      esSaldoAFavor: cuota.lt(ZERO),
    };

    return {
      companyId,
      year,
      month,
      periodExists: period !== null,
      isSpecialContributor,
      seccionA,
      seccionB,
      seccionC,
      seccionD,
      seccionE,
      calculatedAt: new Date(),
    };
  }
}
