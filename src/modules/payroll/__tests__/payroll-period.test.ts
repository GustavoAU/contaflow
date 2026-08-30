// src/modules/payroll/__tests__/payroll-period.test.ts
//
// `PayrollConfig.frequency` era decorativo: el formulario proponia SIEMPRE
// quincenas sin mirarlo. Estos tests fijan que ahora manda.

import { describe, it, expect } from "vitest";
import { periodoPorDefecto, finDesdeInicio } from "../utils/payroll-period";

describe("periodoPorDefecto", () => {
  it("MENSUAL: del 1 al ultimo dia, sin importar el dia de hoy", () => {
    expect(periodoPorDefecto("2026-08-20", "MONTHLY")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(periodoPorDefecto("2026-08-03", "MONTHLY")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("MENSUAL: respeta los meses de 30 dias y febrero", () => {
    expect(periodoPorDefecto("2026-04-10", "MONTHLY").end).toBe("2026-04-30");
    expect(periodoPorDefecto("2026-02-10", "MONTHLY").end).toBe("2026-02-28");
    // 2028 es bisiesto.
    expect(periodoPorDefecto("2028-02-10", "MONTHLY").end).toBe("2028-02-29");
  });

  it("QUINCENAL: primera o segunda quincena segun el dia", () => {
    expect(periodoPorDefecto("2026-08-10", "BIWEEKLY")).toEqual({ start: "2026-08-01", end: "2026-08-15" });
    expect(periodoPorDefecto("2026-08-20", "BIWEEKLY")).toEqual({ start: "2026-08-16", end: "2026-08-31" });
  });

  it("QUINCENAL: el dia 15 es primera quincena y el 16 segunda", () => {
    expect(periodoPorDefecto("2026-08-15", "BIWEEKLY").end).toBe("2026-08-15");
    expect(periodoPorDefecto("2026-08-16", "BIWEEKLY").start).toBe("2026-08-16");
  });

  it("SEMANAL: lunes a domingo de la semana que contiene la fecha", () => {
    // 2026-08-27 es jueves.
    expect(periodoPorDefecto("2026-08-27", "SEMANAL")).toEqual({ start: "2026-08-24", end: "2026-08-30" });
  });

  it("SEMANAL: el domingo cierra su semana, no abre la siguiente", () => {
    // 2026-08-30 es domingo: pertenece a la semana que empezo el lunes 24.
    expect(periodoPorDefecto("2026-08-30", "SEMANAL")).toEqual({ start: "2026-08-24", end: "2026-08-30" });
  });

  it("SEMANAL: la semana puede cruzar el cambio de mes", () => {
    // 2026-09-02 es miercoles; su lunes es el 31 de agosto.
    expect(periodoPorDefecto("2026-09-02", "SEMANAL")).toEqual({ start: "2026-08-31", end: "2026-09-06" });
  });

  it("no depende de la hora ni del huso: sale de la fecha que le pasan", () => {
    // El defecto que evita: `new Date()` en el render del servidor es UTC, y
    // despues de las 20:00 en Venezuela ya es el dia siguiente. El formulario
    // nacia con el periodo equivocado la noche del 15 y la del ultimo del mes.
    expect(periodoPorDefecto("2026-08-15", "BIWEEKLY").start).toBe("2026-08-01");
    expect(periodoPorDefecto("2026-08-16", "BIWEEKLY").start).toBe("2026-08-16");
  });
});

describe("finDesdeInicio", () => {
  it("MENSUAL: siempre el ultimo dia del mes del inicio", () => {
    expect(finDesdeInicio("2026-04-01", "MONTHLY")).toBe("2026-04-30");
  });

  it("QUINCENAL: 15 o ultimo dia segun el inicio elegido", () => {
    expect(finDesdeInicio("2026-08-01", "BIWEEKLY")).toBe("2026-08-15");
    expect(finDesdeInicio("2026-08-16", "BIWEEKLY")).toBe("2026-08-31");
  });

  it("SEMANAL: seis dias despues del inicio", () => {
    expect(finDesdeInicio("2026-08-24", "SEMANAL")).toBe("2026-08-30");
  });

  it("respeta un inicio que NO es corte, en vez de moverlo", () => {
    // El contador puede estar regularizando algo. Se propone un fin coherente,
    // no se le corrige la fecha por detras.
    expect(finDesdeInicio("2026-08-07", "BIWEEKLY")).toBe("2026-08-15");
    expect(finDesdeInicio("2026-08-20", "BIWEEKLY")).toBe("2026-08-31");
  });
});
