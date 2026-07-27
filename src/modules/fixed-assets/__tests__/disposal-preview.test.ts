// src/modules/fixed-assets/__tests__/disposal-preview.test.ts
// MP-1 (R-5): el preview de DisposeAssetModal debe usar Decimal.js y coincidir
// EXACTAMENTE con el asiento que genera FixedAssetDepreciationService.disposeAsset.
// El código anterior usaba float con doble redondeo (Math.round(x*100)/100 sobre la
// base y otra vez sobre el producto), lo que divergía del server en céntimos.

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  ART66_MONTHS,
  calcArt66Reintegro,
  calcSaleIva,
  monthsBetween,
  parseMoney,
} from "../services/disposal-preview";

const IVA = new Decimal("0.16");

/** Réplica exacta de la fórmula del server (FixedAssetDepreciationService:534-537) */
function serverArt66(cost: Decimal, monthsUsed: number): Decimal {
  return cost
    .times(IVA)
    .times(new Decimal(ART66_MONTHS - monthsUsed).dividedBy(new Decimal(ART66_MONTHS)))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Réplica exacta de la fórmula del server (FixedAssetDepreciationService:453-455) */
function serverSaleIva(proceeds: Decimal): Decimal {
  return proceeds.times(IVA).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Implementación float anterior — se conserva para demostrar la divergencia */
function legacyArt66(cost: number, monthsUsed: number): number {
  const fraction = (ART66_MONTHS - monthsUsed) / ART66_MONTHS;
  const baseIva = Math.round(cost * 0.16 * 100) / 100;
  return Math.round(baseIva * fraction * 100) / 100;
}

describe("parseMoney", () => {
  it("convierte strings válidos a Decimal", () => {
    expect(parseMoney("1234.56").toFixed(2)).toBe("1234.56");
  });

  it("devuelve 0 para vacío, null, undefined e inválidos (equivalente a parseFloat || 0)", () => {
    expect(parseMoney("").toFixed(2)).toBe("0.00");
    expect(parseMoney(null).toFixed(2)).toBe("0.00");
    expect(parseMoney(undefined).toFixed(2)).toBe("0.00");
    expect(parseMoney("abc").toFixed(2)).toBe("0.00");
  });

  it("no pierde precisión en montos grandes (donde float falla)", () => {
    // 0.1 + 0.2 clásico y montos de 15 dígitos
    expect(parseMoney("999999999999.99").toFixed(2)).toBe("999999999999.99");
  });
});

describe("monthsBetween", () => {
  // Fechas locales explícitas: monthsBetween usa getMonth()/getFullYear() (hora local),
  // igual que el server. Construirlas con new Date("YYYY-MM-DD") las parsea como UTC
  // y desplazaría el mes en zonas horarias negativas como la de Venezuela.
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

  it("cuenta meses calendario, ignorando el día", () => {
    expect(monthsBetween(local(2026, 1, 31), local(2026, 2, 1))).toBe(1);
    expect(monthsBetween(local(2025, 1, 15), local(2026, 1, 15))).toBe(12);
    expect(monthsBetween(local(2025, 11, 5), local(2026, 2, 20))).toBe(3);
  });

  it("nunca es negativo (baja anterior a la adquisición)", () => {
    expect(monthsBetween(local(2026, 6, 1), local(2026, 1, 1))).toBe(0);
  });
});

describe("calcSaleIva — paridad con el server (Art. 3 LIVA)", () => {
  const cases = ["0", "0.01", "100", "1234.56", "75.35", "999999.99", "33.33"];

  it.each(cases)("proceeds=%s coincide con el server", (proceeds) => {
    const p = new Decimal(proceeds);
    expect(calcSaleIva(p).toFixed(2)).toBe(serverSaleIva(p).toFixed(2));
  });
});

describe("calcArt66Reintegro — paridad con el server (Art. 66 LIVA)", () => {
  const costs = ["75.35", "1000", "1234.56", "33.33", "0.05", "987654.32"];
  const months = [0, 1, 7, 12, 27, 35];

  for (const cost of costs) {
    for (const m of months) {
      it(`costo=${cost} meses=${m} coincide con el server`, () => {
        const c = new Decimal(cost);
        expect(calcArt66Reintegro(c, m).toFixed(2)).toBe(serverArt66(c, m).toFixed(2));
      });
    }
  }

  it("devuelve 0 cuando el activo tiene 36 meses o más (no aplica reintegro)", () => {
    expect(calcArt66Reintegro(new Decimal("1000"), 36).toFixed(2)).toBe("0.00");
    expect(calcArt66Reintegro(new Decimal("1000"), 48).toFixed(2)).toBe("0.00");
  });

  it("reintegra el 100% del IVA cuando el activo tiene 0 meses de uso", () => {
    expect(calcArt66Reintegro(new Decimal("1000"), 0).toFixed(2)).toBe("160.00");
  });

  it("documenta la divergencia que tenía la implementación float anterior", () => {
    // Caso real de doble redondeo: el cliente mostraba un céntimo de más
    const cost = new Decimal("75.35");
    const monthsUsed = 27;
    const legacy = legacyArt66(75.35, monthsUsed);
    const correcto = calcArt66Reintegro(cost, monthsUsed);
    expect(correcto.toFixed(2)).toBe(serverArt66(cost, monthsUsed).toFixed(2));
    expect(legacy.toFixed(2)).not.toBe(correcto.toFixed(2));
  });
});
