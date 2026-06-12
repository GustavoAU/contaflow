// src/modules/igtf/services/IGTFService.ts
import { Decimal } from "decimal.js";

export const IGTF_RATE = 3; // 3% tasa vigente

export type IGTFCalculation = {
  amount: string;
  igtfRate: number;
  igtfAmount: string;
  total: string; // amount + igtfAmount
};

export class IGTFService {
  // ─── Calcular IGTF ────────────────────────────────────────────────────────
  static calculate(amount: string, rate: number = IGTF_RATE): IGTFCalculation {
    const base = new Decimal(amount);
    const igtfAmount = base.mul(rate).div(100);
    const total = base.plus(igtfAmount);

    return {
      amount: base.toFixed(2),
      igtfRate: rate,
      igtfAmount: igtfAmount.toFixed(2),
      total: total.toFixed(2),
    };
  }

  // ─── Verificar si aplica IGTF ─────────────────────────────────────────────
  // Decreto Constituyente IGTF 2022 Art. 4 — A5 (auditoría 2026-06):
  // Solo aplica si la empresa es CE Y el pago es en divisas.
  static applies(currency: string, isSpecialContributor: boolean): boolean {
    return currency !== "VES" && isSpecialContributor;
  }

  // ─── Obtener descripción ──────────────────────────────────────────────────
  static getDescription(currency: string, isSpecialContributor: boolean): string {
    if (currency !== "VES" && isSpecialContributor) {
      return `IGTF ${IGTF_RATE}% — CE: pago en divisas (${currency})`;
    }
    return "No aplica IGTF";
  }
}
