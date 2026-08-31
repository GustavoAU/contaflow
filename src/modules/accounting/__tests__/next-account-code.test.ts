// src/modules/accounting/__tests__/next-account-code.test.ts

import { describe, it, expect } from "vitest";
import { nextAccountCode, deducirPaso } from "../utils/next-account-code";

const PASIVO = { rangeStart: 2000, rangeEnd: 2999 };

describe("deducirPaso", () => {
  it("deduce 5 de una serie de 5 en 5", () => {
    expect(deducirPaso([2205, 2210, 2215, 2220])).toBe(5);
  });

  it("toma el MINIMO, no la moda: un 10 no debe esconder el hueco del 5", () => {
    // 2205, 2215, 2220 → diffs [10, 5]. Con la moda (10) el hueco del 2210 seria
    // invisible, que es justo lo que se quiere encontrar.
    expect(deducirPaso([2205, 2215, 2220])).toBe(5);
  });

  it("ignora los saltos ENTRE bloques", () => {
    // 2115 → 2205 son 90: cambio de grupo, no el paso de la serie.
    expect(deducirPaso([2105, 2110, 2115, 2205, 2210])).toBe(5);
  });

  it("con un solo codigo no infiere serie: paso 1", () => {
    // Inventar un escalon de 5 desde un unico dato dejaria cuatro numeros libres
    // sin ningun motivo.
    expect(deducirPaso([2205])).toBe(1);
  });

  it("ajusta a las convenciones reales (1, 5, 10), no a la diferencia cruda", () => {
    // 1000 y 1002 dan diferencia 2, pero la rejilla real es de uno en uno: con
    // paso 2 el hueco del 1001 quedaria invisible.
    expect(deducirPaso([1000, 1002])).toBe(1);
    expect(deducirPaso([2205, 2212])).toBe(5);
    expect(deducirPaso([2200, 2230])).toBe(10);
  });
});

describe("nextAccountCode", () => {
  it("continua la serie del plan real, no propone la cabecera de grupo", () => {
    // El defecto que corrige: con pasivos 2105..2235 sugeria 2000 —libre pero
    // ninguna empresa pone ahi una cuenta de movimiento—.
    const plan = ["2105", "2110", "2115", "2205", "2210", "2215", "2220", "2225", "2230", "2235"];
    expect(nextAccountCode({ existing: plan, ...PASIVO })).toBe("2240");
  });

  it("RELLENA el hueco antes de seguir hacia arriba", () => {
    // Lo que pidio el usuario: si falta el 2210, sugerirlo a el y no el 2240.
    const plan = ["2205", "2215", "2220", "2225", "2230", "2235"];
    expect(nextAccountCode({ existing: plan, ...PASIVO })).toBe("2210");
  });

  it("rellena el PRIMER hueco cuando hay varios", () => {
    // Serie de 5 en 5 con dos huecos (2215 y 2225): gana el primero.
    expect(nextAccountCode({
      existing: ["2205", "2210", "2220", "2230"], ...PASIVO,
    })).toBe("2215");
  });

  it("el hueco se busca en la rejilla de LA serie, no en los enteros", () => {
    // 2205, 2215, 2230 → el paso deducido es 10, asi que la serie es
    // 2205/2215/2225/2235 y el primer hueco es 2225. Proponer 2210 seria
    // inventar un escalon que ese plan no usa.
    expect(nextAccountCode({ existing: ["2205", "2215", "2230"], ...PASIVO })).toBe("2225");
  });

  it("trabaja sobre el ULTIMO bloque, no sobre todo el rango", () => {
    // Hay hueco en el bloque 21xx (falta 2110), pero la cuenta nueva continua
    // donde el contador esta trabajando: el bloque 22xx.
    const plan = ["2105", "2115", "2205", "2210"];
    expect(nextAccountCode({ existing: plan, ...PASIVO })).toBe("2215");
  });

  it("NO propone por debajo del primer codigo del bloque", () => {
    // 2205 es donde el plan decidio empezar: proponer 2200 o 2105 seria pelearse
    // con esa decision.
    const r = nextAccountCode({ existing: ["2205", "2210"], ...PASIVO })!;
    expect(Number(r)).toBeGreaterThan(2210);
  });

  it("sin cuentas de ese tipo, propone el inicio del rango", () => {
    expect(nextAccountCode({ existing: [], ...PASIVO })).toBe("2000");
  });

  it("ignora codigos de otros rangos y los no numericos", () => {
    // El 5105 es de gastos y "1-1-01" no es un numero: ninguno debe influir ni en
    // el paso deducido ni en el hueco que se busca.
    expect(nextAccountCode({
      existing: ["5105", "1-1-01", "2205", "2210"], ...PASIVO,
    })).toBe("2215");
  });

  it("respeta un plan que va de 10 en 10", () => {
    expect(nextAccountCode({ existing: ["2200", "2210", "2220"], ...PASIVO })).toBe("2230");
  });

  it("si no queda sitio hacia arriba, busca hueco hacia atras", () => {
    // Todo 2001..2999 ocupado y el 2000 libre: la serie no puede continuar, asi
    // que se recurre al primer hueco que quede en el rango.
    const casi = Array.from({ length: 999 }, (_, i) => String(2001 + i));
    expect(nextAccountCode({ existing: casi, ...PASIVO })).toBe("2000");
  });

  it("devuelve null solo si el rango esta REALMENTE agotado", () => {
    const todos = Array.from({ length: 1000 }, (_, i) => String(2000 + i));
    expect(nextAccountCode({ existing: todos, ...PASIVO })).toBeNull();
  });
});
