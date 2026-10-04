import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";

import { calcInstallment } from "../services/loan-installment";

describe("calcInstallment", () => {
  it("sin interés: total / n redondeado hacia arriba", () => {
    expect(calcInstallment(new Decimal("1000"), 3, null).toFixed(2)).toBe("333.34");
    expect(calcInstallment(new Decimal("1200"), 12, new Decimal(0)).toFixed(2)).toBe("100.00");
  });

  it("método francés: 1200 a 12 cuotas al 12% anual = 106.62", () => {
    // r = 0,01; cuota = 1200·0,01·1,01^12 / (1,01^12 − 1) = 106,6185… → 106,62
    expect(calcInstallment(new Decimal("1200"), 12, new Decimal("0.12")).toFixed(2)).toBe("106.62");
  });

  it("el redondeo es siempre hacia arriba, nunca al más cercano", () => {
    // 100 / 3 = 33,333… → 33,34 (al más cercano daría 33,33)
    expect(calcInstallment(new Decimal("100"), 3, null).toFixed(2)).toBe("33.34");
  });

  it("la suma de cuotas nunca queda por debajo del principal sin interés", () => {
    const cuota = calcInstallment(new Decimal("1000.01"), 7, null);
    expect(cuota.times(7).gte("1000.01")).toBe(true);
  });
});
