// src/modules/payroll/__tests__/legal-thresholds-reference.test.ts
//
// Fija los valores de referencia sembrados (verificados contra Gaceta Oficial)
// y prueba que las tasas se DERIVAN de PayrollCalculatorService, nunca se
// teclean dos veces — un cambio ahí que no se refleje aquí sería exactamente
// la clase de desajuste silencioso que este archivo existe para detectar.

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  SALARY_MIN_VES_REFERENCE,
  RATE_REFERENCE_PCT,
  IVSS_PAT_RATE_REFERENCE_PCT,
} from "../legal-thresholds-reference";
import {
  DEFAULT_IVSS_WORKER_RATE,
  DEFAULT_INCES_PAT_RATE,
  DEFAULT_FAOV_WORKER_RATE,
  DEFAULT_FAOV_PAT_RATE,
  DEFAULT_RPE_WORKER_RATE,
  DEFAULT_RPE_PAT_RATE,
  IVSS_PAT_RATE_BY_RISK,
} from "../services/PayrollCalculatorService";

describe("legal-thresholds-reference", () => {
  it("salario mínimo: Bs. 130 (Decreto 4.653, G.O. 42.339, 01-03-2022)", () => {
    expect(SALARY_MIN_VES_REFERENCE.eq(new Decimal("130.00"))).toBe(true);
  });

  it("las tasas de referencia están en PUNTOS PORCENTUALES, no en fracción", () => {
    // 4% se guarda como "4.00" en LegalThreshold.value, no como "0.04".
    expect(RATE_REFERENCE_PCT.IVSS_OBR_RATE.eq(new Decimal("4.00"))).toBe(true);
    expect(RATE_REFERENCE_PCT.INCES_PAT_RATE.eq(new Decimal("2.00"))).toBe(true);
    expect(RATE_REFERENCE_PCT.FAOV_OBR_RATE.eq(new Decimal("1.00"))).toBe(true);
    expect(RATE_REFERENCE_PCT.FAOV_PAT_RATE.eq(new Decimal("2.00"))).toBe(true);
    expect(RATE_REFERENCE_PCT.RPE_OBR_RATE.eq(new Decimal("0.50"))).toBe(true);
    expect(RATE_REFERENCE_PCT.RPE_PAT_RATE.eq(new Decimal("2.00"))).toBe(true);
  });

  it("INCES_OBR_RATE (0,5% sobre utilidades, Ley INCES Art. 50) no se deriva del calculador: no existe ahí", () => {
    // A proposito: PayrollCalculatorService no calcula este concepto todavia.
    expect(RATE_REFERENCE_PCT.INCES_OBR_RATE.eq(new Decimal("0.50"))).toBe(true);
  });

  it("cada tasa derivada coincide EXACTAMENTE con la constante que usa el calculador (×100)", () => {
    // Si esto falla, alguien cambió una de las dos y no la otra.
    expect(RATE_REFERENCE_PCT.IVSS_OBR_RATE.eq(DEFAULT_IVSS_WORKER_RATE.times(100))).toBe(true);
    expect(RATE_REFERENCE_PCT.INCES_PAT_RATE.eq(DEFAULT_INCES_PAT_RATE.times(100))).toBe(true);
    expect(RATE_REFERENCE_PCT.FAOV_OBR_RATE.eq(DEFAULT_FAOV_WORKER_RATE.times(100))).toBe(true);
    expect(RATE_REFERENCE_PCT.FAOV_PAT_RATE.eq(DEFAULT_FAOV_PAT_RATE.times(100))).toBe(true);
    expect(RATE_REFERENCE_PCT.RPE_OBR_RATE.eq(DEFAULT_RPE_WORKER_RATE.times(100))).toBe(true);
    expect(RATE_REFERENCE_PCT.RPE_PAT_RATE.eq(DEFAULT_RPE_PAT_RATE.times(100))).toBe(true);
  });

  it("IVSS patronal por clase de riesgo: 9% / 10% / 11% (LSS Reglamento Art. 108/109)", () => {
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MINIMO.eq(new Decimal("9.00"))).toBe(true);
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MEDIO.eq(new Decimal("10.00"))).toBe(true);
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MAXIMO.eq(new Decimal("11.00"))).toBe(true);
    // Derivadas, no tecleadas dos veces.
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MINIMO.eq(IVSS_PAT_RATE_BY_RISK.MINIMO.times(100))).toBe(true);
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MEDIO.eq(IVSS_PAT_RATE_BY_RISK.MEDIO.times(100))).toBe(true);
    expect(IVSS_PAT_RATE_REFERENCE_PCT.MAXIMO.eq(IVSS_PAT_RATE_BY_RISK.MAXIMO.times(100))).toBe(true);
  });
});
