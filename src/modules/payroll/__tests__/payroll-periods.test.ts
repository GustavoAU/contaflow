// src/modules/payroll/__tests__/payroll-periods.test.ts
//
// Períodos de nómina derivados de los días que la empresa USA como inicio.

import { describe, it, expect } from "vitest";
import {
  periodosDelMes,
  ultimoPeriodoCerrado,
  diasDesdeCierre,
} from "../utils/payroll-periods";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("periodosDelMes", () => {
  it("parte el mes en quincenas y el último período llega a fin de mes", () => {
    const p = periodosDelMes(2026, 7, [1, 16]); // agosto (mes0 = 7)
    expect(p.map((x) => `${iso(x.inicio)}→${iso(x.fin)}`)).toEqual([
      "2026-08-01→2026-08-15",
      "2026-08-16→2026-08-31",
    ]);
  });

  it("febrero termina el 28, no el 31", () => {
    const p = periodosDelMes(2026, 1, [1, 16]);
    expect(iso(p[1].fin)).toBe("2026-02-28");
  });

  it("un día de corte mayor que el mes se recorta al último día", () => {
    const p = periodosDelMes(2026, 1, [1, 31]);
    expect(iso(p[1].inicio)).toBe("2026-02-28");
  });
});

describe("ultimoPeriodoCerrado", () => {
  // El caso real: el 2 de septiembre lo que toca cobrar es la segunda quincena
  // de AGOSTO. Tomar el período en curso pagaría trabajo no realizado.
  it("el 2 de septiembre el período cerrado es el 16→31 de agosto", () => {
    const p = ultimoPeriodoCerrado([1, 16], new Date("2026-09-02T12:00:00Z"))!;
    expect(iso(p.inicio)).toBe("2026-08-16");
    expect(iso(p.fin)).toBe("2026-08-31");
  });

  it("el día 1 el período cerrado es el que acaba de terminar, no el que empieza", () => {
    const p = ultimoPeriodoCerrado([1, 16], new Date("2026-09-01T12:00:00Z"))!;
    expect(iso(p.fin)).toBe("2026-08-31");
  });

  it("en mensual el 2 de septiembre cierra agosto completo", () => {
    const p = ultimoPeriodoCerrado([1], new Date("2026-09-02T12:00:00Z"))!;
    expect(iso(p.inicio)).toBe("2026-08-01");
    expect(iso(p.fin)).toBe("2026-08-31");
  });

  it("el 20 de septiembre ya cerró la primera quincena de septiembre", () => {
    const p = ultimoPeriodoCerrado([1, 16], new Date("2026-09-20T12:00:00Z"))!;
    expect(iso(p.inicio)).toBe("2026-09-01");
    expect(iso(p.fin)).toBe("2026-09-15");
  });

  it("el 1 de enero retrocede a diciembre del año anterior", () => {
    const p = ultimoPeriodoCerrado([1, 16], new Date("2027-01-01T12:00:00Z"))!;
    expect(iso(p.inicio)).toBe("2026-12-16");
    expect(iso(p.fin)).toBe("2026-12-31");
  });

  it("sin días de corte (semanal) no hay período que reclamar", () => {
    expect(ultimoPeriodoCerrado([], new Date("2026-09-02T12:00:00Z"))).toBeNull();
  });
});

describe("diasDesdeCierre", () => {
  it("cuenta los días transcurridos desde el fin del período", () => {
    const p = ultimoPeriodoCerrado([1, 16], new Date("2026-09-08T12:00:00Z"))!;
    expect(diasDesdeCierre(p, new Date("2026-09-08T12:00:00Z"))).toBe(8);
  });
});
