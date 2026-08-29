// src/modules/payroll/__tests__/payroll-run.schema.test.ts
// Validación de entrada del proceso de nómina.
//
// Existe por un hallazgo HIGH de la auditoría pre-merge (2026-08-29): desde que
// el IVSS se cotiza por semana (Reglamento Art. 99), el importe del aporte es
// LINEAL en la cantidad de lunes que abarca el período — y el período lo manda
// el cliente. Antes de ese cambio la duración no influía en ninguna cifra, así
// que nadie la había acotado.

import { describe, it, expect } from "vitest";
import { CreatePayrollRunSchema } from "../schemas/payroll-run.schema";

const BASE = { idempotencyKey: "key-1" };

function parse(periodStart: string, periodEnd: string) {
  return CreatePayrollRunSchema.safeParse({ ...BASE, periodStart, periodEnd });
}

describe("CreatePayrollRunSchema — duración del período", () => {
  it("acepta un mes completo", () => {
    expect(parse("2026-03-01", "2026-03-31").success).toBe(true);
  });

  it("acepta una quincena", () => {
    expect(parse("2026-03-01", "2026-03-15").success).toBe(true);
  });

  it("acepta una semana", () => {
    expect(parse("2026-03-01", "2026-03-07").success).toBe(true);
  });

  it("acepta un mes de 31 días con holgura", () => {
    // 35 días es el tope: cubre el mes más largo sin quedarse corto.
    expect(parse("2026-01-01", "2026-02-04").success).toBe(true);
  });

  it("RECHAZA un período de dos meses y medio", () => {
    // Este es el caso que no requería ninguna precondición: `periodEnd` seguía
    // dentro de los 45 días futuros que el schema ya validaba, y el IVSS del
    // trabajador se multiplicaba por 2,2.
    const r = parse("2026-08-01", "2026-10-13");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("35 días"))).toBe(true);
    }
  });

  it("RECHAZA un período de tres años", () => {
    expect(parse("2023-01-01", "2026-03-31").success).toBe(false);
  });

  it("sigue rechazando fin anterior al inicio", () => {
    expect(parse("2026-03-31", "2026-03-01").success).toBe(false);
  });

  it("sigue rechazando fechas fuera del rango de negocio", () => {
    // zBusinessDateString: el typo de año (12026) que tumbó listados enteros en
    // la auditoría de Compras/Ventas. Este schema usaba un regex propio.
    expect(parse("12026-03-01", "12026-03-31").success).toBe(false);
  });
});
