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
  // MEDIUM-3: monthsBetween usa getters UTC (getUTCMonth/getUTCFullYear), igual que
  // el server, porque las fechas de negocio se persisten a medianoche UTC. Estas
  // fechas se construyen al mediodía local para que el día no cruce a otro mes y los
  // casos de abajo midan solo la aritmética de meses.
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

  /** Fecha de negocio tal como la persiste Prisma: medianoche UTC. */
  const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("cuenta meses calendario, ignorando el día", () => {
    expect(monthsBetween(local(2026, 1, 31), local(2026, 2, 1))).toBe(1);
    expect(monthsBetween(local(2025, 1, 15), local(2026, 1, 15))).toBe(12);
    expect(monthsBetween(local(2025, 11, 5), local(2026, 2, 20))).toBe(3);
  });

  it("nunca es negativo (baja anterior a la adquisición)", () => {
    expect(monthsBetween(local(2026, 6, 1), local(2026, 1, 1))).toBe(0);
  });

  // MEDIUM-3 — regresión. Con getters LOCALES este caso daba 11 en el navegador
  // (Venezuela, UTC−4: el 01/03 a medianoche UTC se lee 28/02 20:00 → febrero) y 12
  // en el server (proceso UTC → marzo). El usuario veía un reintegro Art. 66
  // distinto del que se contabilizaba, por costo×16%/36 de diferencia.
  //
  // Nota: en un runner con TZ=UTC local y UTC coinciden y este caso pasa igual; lo
  // que discrimina es correrlo en una zona negativa — que es justo donde vive el
  // usuario y donde el bug se manifestaba.
  it("MEDIUM-3: fechas de negocio (medianoche UTC) no se desplazan al mes anterior", () => {
    const adquisicion = utcDate("2025-03-01");
    const baja = utcDate("2026-03-01");
    expect(monthsBetween(adquisicion, baja)).toBe(12);
  });

  it("MEDIUM-3: caso asimétrico — solo una de las dos fechas cruza el mes", () => {
    // 15/01 no cruza en UTC−4; 01/03 sí (se leería como 28/02 → febrero).
    const adquisicion = utcDate("2026-01-15");
    const baja = utcDate("2026-03-01");
    // UTC: (2026−2026)×12 + (marzo−enero) = 2. Con getters locales daba 1.
    expect(monthsBetween(adquisicion, baja)).toBe(2);
  });

  it("MEDIUM-3: el server usa la MISMA fórmula — paridad exacta", () => {
    // Réplica literal de FixedAssetDepreciationService (bloque Art. 66).
    const serverMonths = (acq: Date, disp: Date) =>
      Math.max(
        0,
        (disp.getUTCFullYear() - acq.getUTCFullYear()) * 12 +
          (disp.getUTCMonth() - acq.getUTCMonth()),
      );
    const casos: Array<[string, string]> = [
      ["2026-01-15", "2026-03-01"],
      ["2025-12-31", "2026-01-01"],
      ["2024-02-29", "2026-03-01"],
      ["2026-03-01", "2026-03-01"],
    ];
    for (const [a, d] of casos) {
      expect(monthsBetween(utcDate(a), utcDate(d))).toBe(serverMonths(utcDate(a), utcDate(d)));
    }
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
