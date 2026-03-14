// src/modules/retentions/services/RetentionService.ts
import { Decimal } from "decimal.js";
import { ISLR_RATES, IVA_RETENTION_RATES } from "../schemas/retention.schema";

export type RetentionCalculation = {
  taxBase: string;
  ivaAmount: string;
  ivaRetention: string;
  ivaRetentionPct: number;
  islrAmount: string | null;
  islrRetentionPct: number | null;
  totalRetention: string;
};

export class RetentionService {
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

  // ─── Calcular retención completa ───────────────────────────────────────────
  static calculate(
    taxBase: string,
    ivaRetentionPct: 75 | 100 = 75,
    islrCode?: string,
    ivaRate: number = 16
  ): RetentionCalculation {
    const iva = this.calculateIvaRetention(taxBase, ivaRate, ivaRetentionPct);
    const islr = islrCode ? this.calculateIslrRetention(taxBase, islrCode) : null;

    const total = new Decimal(iva.ivaRetention).plus(
      islr ? new Decimal(islr.islrAmount) : new Decimal(0)
    );

    return {
      taxBase,
      ivaAmount: iva.ivaAmount,
      ivaRetention: iva.ivaRetention,
      ivaRetentionPct: iva.ivaRetentionPct,
      islrAmount: islr?.islrAmount ?? null,
      islrRetentionPct: islr?.islrRetentionPct ?? null,
      totalRetention: total.toFixed(2),
    };
  }

  // ─── Validar RIF venezolano ────────────────────────────────────────────────
  static validateRif(rif: string): boolean {
    return /^[JVGPE]-\d{8}-\d$/.test(rif);
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
