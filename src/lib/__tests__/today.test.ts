// src/lib/__tests__/today.test.ts
//
// El bug que motiva esta librería: `new Date().toISOString().slice(0, 10)` no es
// "hoy", es "hoy en UTC". En Venezuela (UTC−4) se adelanta un día a partir de las
// 20:00 locales.
//
// Los casos usan instantes con offset EXPLÍCITO (`-04:00`) y zona IANA explícita,
// así que dan el mismo resultado corra el runner en la zona que corra — que es lo
// que hace que este test valga: el bug original era invisible justo porque CI y
// Vercel corren en UTC.

import { describe, it, expect } from "vitest";
import { todayInTimeZone, todayLocalISO, currentMonthLocalISO } from "../today";

const CARACAS = "America/Caracas"; // UTC−4, sin horario de verano desde 2016
const BOGOTA = "America/Bogota"; // UTC−5 — el siguiente país del roadmap (ADR-042)

describe("todayInTimeZone", () => {
  it("devuelve el día del usuario, no el día UTC, en la franja nocturna", () => {
    const nocheEnCaracas = new Date("2026-08-10T21:00:00-04:00");

    expect(todayInTimeZone(CARACAS, nocheEnCaracas)).toBe("2026-08-10");
    // Prueba de que el patrón viejo estaba mal — no es decorativo:
    expect(nocheEnCaracas.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("CRÍTICO: la noche del último día del mes no salta de período contable", () => {
    // Este es el caso caro: un asiento o un pago registrados a las 22:00 del 31
    // quedaban pre-llenados con el 1 del mes siguiente → otro AccountingPeriod.
    const cierreDeMes = new Date("2026-07-31T22:00:00-04:00");

    expect(todayInTimeZone(CARACAS, cierreDeMes)).toBe("2026-07-31");
    expect(cierreDeMes.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("respeta zonas distintas para el mismo instante (multi-país)", () => {
    // 00:30 UTC del 11 = 20:30 del 10 en Caracas y 19:30 del 10 en Bogotá.
    const instante = new Date("2026-08-11T00:30:00Z");

    expect(todayInTimeZone(CARACAS, instante)).toBe("2026-08-10");
    expect(todayInTimeZone(BOGOTA, instante)).toBe("2026-08-10");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("coincide con UTC cuando la zona es UTC", () => {
    const instante = new Date("2026-08-10T21:00:00Z");
    expect(todayInTimeZone("UTC", instante)).toBe("2026-08-10");
  });

  it("rellena con ceros año/mes/día de un dígito", () => {
    expect(todayInTimeZone(CARACAS, new Date("2026-01-05T12:00:00-04:00"))).toBe("2026-01-05");
  });

  it("degrada al día UTC ante una zona inválida en vez de lanzar", () => {
    const instante = new Date("2026-08-10T21:00:00Z");
    expect(todayInTimeZone("No/Existe", instante)).toBe("2026-08-10");
  });
});

describe("todayLocalISO", () => {
  // Construir con `new Date(y, m, d, h)` fija los componentes LOCALES, así que
  // leerlos en local es determinista en cualquier runner.
  it("devuelve los componentes locales, sin pasar por UTC", () => {
    expect(todayLocalISO(new Date(2026, 6, 31, 22, 0, 0))).toBe("2026-07-31");
    expect(todayLocalISO(new Date(2026, 0, 5, 0, 30, 0))).toBe("2026-01-05");
    expect(todayLocalISO(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });

  it("concuerda con todayInTimeZone para la zona del propio runner", () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const instante = new Date("2026-08-10T21:00:00-04:00");
    expect(todayLocalISO(instante)).toBe(todayInTimeZone(tz, instante));
  });
});

describe("currentMonthLocalISO", () => {
  it("devuelve YYYY-MM del día local", () => {
    expect(currentMonthLocalISO(new Date(2026, 6, 31, 22, 0, 0))).toBe("2026-07");
    expect(currentMonthLocalISO(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01");
  });
});
