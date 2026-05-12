// src/modules/retentions/services/RetentionCalculator.ts
// SIN IMPORTAR PRISMA — funciones puras de cálculo fiscal
// Seguro para importar desde Client Components ("use client")
import { Decimal } from "decimal.js";
import { ISLR_RATES, IVA_RETENTION_RATES, INCES_RATE, FAT_RATE } from "../schemas/retention.schema";

export type RetentionCalculation = {
  taxBase: string;
  ivaAmount: string;
  ivaRetention: string;
  ivaRetentionPct: number;
  islrAmount: string | null;
  islrRetentionPct: number | null;
  incesAmount: string | null;
  incesRetentionPct: number | null;
  fatAmount: string | null;
  fatRetentionPct: number | null;
  totalRetention: string;
};

export class RetentionCalculator {
  // ─── Calcular retención IVA ────────────────────────────────────────────────
  static calculateIvaRetention(
    taxBase: string,
    ivaRate: number = 16,
    retentionPct: 75 | 100 = 75
  ): { ivaAmount: string; ivaRetention: string; ivaRetentionPct: number } {
    const base = new Decimal(taxBase);
    const ivaAmount = base.mul(ivaRate).div(100);
    const retention = ivaAmount.mul(retentionPct).div(100);

    return {
      ivaAmount: ivaAmount.toFixed(2),
      ivaRetention: retention.toFixed(2),
      ivaRetentionPct: retentionPct,
    };
  }

  // ─── Calcular retención ISLR ───────────────────────────────────────────────
  static calculateIslrRetention(
    taxBase: string,
    islrCode: string
  ): { islrAmount: string; islrRetentionPct: number } | null {
    const rate = ISLR_RATES[islrCode];
    if (!rate) return null;

    const base = new Decimal(taxBase);
    const retention = base.mul(rate.pct).div(100);

    return {
      islrAmount: retention.toFixed(2),
      islrRetentionPct: rate.pct,
    };
  }

  // ─── Calcular retención INCES (2%) ────────────────────────────────────────
  static calculateIncesRetention(taxBase: string): { incesAmount: string; incesRetentionPct: number } {
    const base = new Decimal(taxBase);
    const retention = base.mul(INCES_RATE.pct).div(100);
    return {
      incesAmount: retention.toFixed(2),
      incesRetentionPct: INCES_RATE.pct,
    };
  }

  // ─── Calcular retención FAT (0.75%) ───────────────────────────────────────
  static calculateFatRetention(taxBase: string): { fatAmount: string; fatRetentionPct: number } {
    const base = new Decimal(taxBase);
    const retention = base.mul(FAT_RATE.pct).div(100);
    return {
      fatAmount: retention.toFixed(2),
      fatRetentionPct: FAT_RATE.pct,
    };
  }

  // ─── Calcular retención completa ───────────────────────────────────────────
  static calculate(
    taxBase: string,
    ivaRetentionPct: 75 | 100 = 75,
    islrCode?: string,
    ivaRate: number = 16,
    type: "IVA" | "ISLR" | "AMBAS" = "AMBAS",
    applyInces: boolean = false,
    applyFat: boolean = false
  ): RetentionCalculation {
    const includeIva = type !== "ISLR";
    const iva = this.calculateIvaRetention(taxBase, ivaRate, ivaRetentionPct);
    const islr = islrCode ? this.calculateIslrRetention(taxBase, islrCode) : null;
    const inces = applyInces ? this.calculateIncesRetention(taxBase) : null;
    const fat = applyFat ? this.calculateFatRetention(taxBase) : null;

    const total = (includeIva ? new Decimal(iva.ivaRetention) : new Decimal(0))
      .plus(islr ? new Decimal(islr.islrAmount) : new Decimal(0))
      .plus(inces ? new Decimal(inces.incesAmount) : new Decimal(0))
      .plus(fat ? new Decimal(fat.fatAmount) : new Decimal(0));

    return {
      taxBase,
      ivaAmount: includeIva ? iva.ivaAmount : "0.00",
      ivaRetention: includeIva ? iva.ivaRetention : "0.00",
      ivaRetentionPct: iva.ivaRetentionPct,
      islrAmount: islr?.islrAmount ?? null,
      islrRetentionPct: islr?.islrRetentionPct ?? null,
      incesAmount: inces?.incesAmount ?? null,
      incesRetentionPct: inces?.incesRetentionPct ?? null,
      fatAmount: fat?.fatAmount ?? null,
      fatRetentionPct: fat?.fatRetentionPct ?? null,
      totalRetention: total.toFixed(2),
    };
  }

  // ─── Obtener descripción de tasa ISLR ─────────────────────────────────────
  static getIslrRateDescription(islrCode: string): string {
    return ISLR_RATES[islrCode]?.description ?? "Código ISLR desconocido";
  }

  // ─── Obtener tasa IVA según tipo ───────────────────────────────────────────
  static getIvaRetentionRate(
    full: boolean = false
  ): (typeof IVA_RETENTION_RATES)[keyof typeof IVA_RETENTION_RATES] {
    return full ? IVA_RETENTION_RATES.FULL : IVA_RETENTION_RATES.STANDARD;
  }
}
