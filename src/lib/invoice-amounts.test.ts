// src/modules/invoices/services/invoice-amounts.test.ts
//
// TDD SPEC (RED) — fix/factura-lujo-total
// Entregado como contrato ejecutable para quien implemente `invoice-amounts.ts`.
// Todos los tests de este archivo FALLAN hoy: el módulo no existe todavía.
// No modificar este archivo para hacerlo pasar — implementar el módulo.
//
// Bug: una factura de lujo (ADICIONAL_31) se guarda como DOS InvoiceTaxLine con la MISMA
// base (IVA_GENERAL 16% + IVA_ADICIONAL 15%). Sumar `base + amount` de TODAS las líneas
// cuenta la base dos veces (2310 en vez de 1310 para base 1000).
//
// Fórmula (mismo criterio que `bookAmounts` en InvoiceService.ts):
//   base  = Σ base IVA_GENERAL + Σ base IVA_REDUCIDO + Σ base EXENTO
//           + max(0, Σ base IVA_ADICIONAL − Σ base IVA_GENERAL)
//   iva   = Σ amount de TODAS las líneas
//   total = base + iva
//
// Los valores esperados están escritos a mano (oráculo independiente de la fórmula) y todo
// el cálculo es Decimal.js (R-5). Los importes 1333.33 / 100.10 / 0.1 + 0.2 están elegidos
// para exponer errores IEEE 754 si alguien suma con `number`.

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { Prisma } from "@prisma/client";
import {
  invoiceBaseAndIva,
  invoiceTotalAmount,
  type AmountTaxLine,
} from "./invoice-amounts";

// ─── Helpers de fixture ───────────────────────────────────────────────────────

const line = (
  taxType: string,
  base: AmountTaxLine["base"],
  amount: AmountTaxLine["amount"],
): AmountTaxLine => ({ taxType, base, amount });

/** Las dos filas que hoy guarda una factura de lujo de base `base` (16% + 15%). */
const luxuryPair = (base: string, general: string, additional: string): AmountTaxLine[] => [
  line("IVA_GENERAL", base, general),
  line("IVA_ADICIONAL", base, additional),
];

const fmt = (lines: AmountTaxLine[]) => {
  const { base, iva } = invoiceBaseAndIva(lines);
  return {
    base: base.toFixed(2),
    iva: iva.toFixed(2),
    total: invoiceTotalAmount(lines).toFixed(2),
  };
};

// ─── Lujo: la base se cuenta UNA sola vez ─────────────────────────────────────

describe("invoiceBaseAndIva / invoiceTotalAmount — lujo (ADICIONAL_31)", () => {
  it("base 1000 con G 1000/160.00 + A 1000/150.00 → base 1000, iva 310, total 1310 (no 2310)", () => {
    expect(fmt(luxuryPair("1000.00", "160.00", "150.00"))).toEqual({
      base: "1000.00",
      iva: "310.00",
      total: "1310.00",
    });
  });

  it("lujo con centavos (1333.33 → IVA 213.33 + 200.00) sin error de coma flotante", () => {
    expect(fmt(luxuryPair("1333.33", "213.33", "200.00"))).toEqual({
      base: "1333.33",
      iva: "413.33",
      total: "1746.66",
    });
  });

  it("factura mixta: general normal 600 + lujo 400 (tres filas) → la base adicional ya está cubierta por la general", () => {
    // deriveInvoiceTaxLines produce una fila IVA_GENERAL por grupo suntuario además de la
    // general normal: ΣG = 600 + 400 = 1000, ΣA = 400 → base 1000, no 1400.
    const lines = [
      line("IVA_GENERAL", "600.00", "96.00"),
      line("IVA_GENERAL", "400.00", "64.00"),
      line("IVA_ADICIONAL", "400.00", "60.00"),
    ];
    expect(fmt(lines)).toEqual({ base: "1000.00", iva: "220.00", total: "1220.00" });
  });

  it("dos grupos suntuarios en la misma factura → cada base adicional está cubierta por su general", () => {
    const lines = [
      ...luxuryPair("400.00", "64.00", "60.00"),
      ...luxuryPair("300.00", "48.00", "45.00"),
    ];
    // ΣG = 700, ΣA = 700 → base 700 · iva 64+60+48+45 = 217
    expect(fmt(lines)).toEqual({ base: "700.00", iva: "217.00", total: "917.00" });
  });

  it("solo IVA_ADICIONAL (línea manual sin IVA_GENERAL) conserva su base", () => {
    expect(fmt([line("IVA_ADICIONAL", "1000.00", "150.00")])).toEqual({
      base: "1000.00",
      iva: "150.00",
      total: "1150.00",
    });
  });

  it("IVA_ADICIONAL mayor que IVA_GENERAL: el exceso cuenta como base propia", () => {
    // ΣG = 400, ΣA = 1000 → base = 400 + max(0, 1000 − 400) = 1000
    const lines = [line("IVA_GENERAL", "400.00", "64.00"), line("IVA_ADICIONAL", "1000.00", "150.00")];
    expect(fmt(lines)).toEqual({ base: "1000.00", iva: "214.00", total: "1214.00" });
  });

  it("IVA_ADICIONAL menor que IVA_GENERAL: NO suma base extra (queda cubierta)", () => {
    // ΣG = 1000, ΣA = 400 → base 1000 (max(0, 400 − 1000) = 0)
    const lines = [line("IVA_GENERAL", "1000.00", "160.00"), line("IVA_ADICIONAL", "400.00", "60.00")];
    expect(fmt(lines)).toEqual({ base: "1000.00", iva: "220.00", total: "1220.00" });
  });

  it("lujo + reducido + exento en la misma factura: la base de cada alícuota entra una vez", () => {
    const lines = [
      ...luxuryPair("1000.00", "160.00", "150.00"),
      line("IVA_REDUCIDO", "500.00", "40.00"),
      line("EXENTO", "200.00", "0.00"),
    ];
    // base = 1000 (G) + 500 (R) + 200 (E) + max(0, 1000 − 1000) = 1700
    // iva  = 160 + 150 + 40 + 0 = 350 → total 2050
    expect(fmt(lines)).toEqual({ base: "1700.00", iva: "350.00", total: "2050.00" });
  });
});

// ─── Sin lujo: el resultado no cambia respecto al criterio histórico (base + iva) ──

describe("invoiceBaseAndIva / invoiceTotalAmount — facturas sin lujo", () => {
  it("solo general: 1000 / 160 → total 1160", () => {
    expect(fmt([line("IVA_GENERAL", "1000.00", "160.00")])).toEqual({
      base: "1000.00",
      iva: "160.00",
      total: "1160.00",
    });
  });

  it("solo reducido: 1000 / 80 → total 1080", () => {
    expect(fmt([line("IVA_REDUCIDO", "1000.00", "80.00")])).toEqual({
      base: "1000.00",
      iva: "80.00",
      total: "1080.00",
    });
  });

  it("solo exento: 500 / 0 → total 500", () => {
    expect(fmt([line("EXENTO", "500.00", "0.00")])).toEqual({
      base: "500.00",
      iva: "0.00",
      total: "500.00",
    });
  });

  it("mezcla general + reducido (caso real): G 270/43.20 + R 787430/62994.40 → base 787700, iva 63037.60, total 850737.60", () => {
    const lines = [
      line("IVA_GENERAL", "270.00", "43.20"),
      line("IVA_REDUCIDO", "787430.00", "62994.40"),
    ];
    expect(fmt(lines)).toEqual({ base: "787700.00", iva: "63037.60", total: "850737.60" });
  });

  it("dos filas generales (sin lujo) suman ambas bases", () => {
    const lines = [line("IVA_GENERAL", "600.00", "96.00"), line("IVA_GENERAL", "400.00", "64.00")];
    expect(fmt(lines)).toEqual({ base: "1000.00", iva: "160.00", total: "1160.00" });
  });

  it("lista vacía → base 0, iva 0, total 0", () => {
    expect(fmt([])).toEqual({ base: "0.00", iva: "0.00", total: "0.00" });
  });
});

// ─── Tipos de entrada y precisión (R-5) ───────────────────────────────────────

describe("invoiceBaseAndIva / invoiceTotalAmount — tipos de entrada y precisión", () => {
  const AS_STRING = luxuryPair("1000", "160", "150");
  const AS_NUMBER = luxuryPair("1000", "160", "150").map((l) => ({
    ...l,
    base: Number(l.base.toString()),
    amount: Number(l.amount.toString()),
  }));
  const AS_DECIMAL = luxuryPair("1000", "160", "150").map((l) => ({
    ...l,
    base: new Decimal(l.base.toString()),
    amount: new Decimal(l.amount.toString()),
  }));
  const AS_PRISMA_DECIMAL = luxuryPair("1000", "160", "150").map((l) => ({
    ...l,
    base: new Prisma.Decimal(l.base.toString()),
    amount: new Prisma.Decimal(l.amount.toString()),
  }));

  it.each([
    ["string", AS_STRING],
    ["number", AS_NUMBER],
    ["Decimal", AS_DECIMAL],
    ["Prisma.Decimal", AS_PRISMA_DECIMAL],
  ])("acepta base/amount como %s y da el mismo resultado (1310)", (_label, lines) => {
    expect(fmt(lines)).toEqual({ base: "1000.00", iva: "310.00", total: "1310.00" });
  });

  it("los resultados son instancias de Decimal, no number", () => {
    const lines = luxuryPair("1000.00", "160.00", "150.00");
    const { base, iva } = invoiceBaseAndIva(lines);
    const total = invoiceTotalAmount(lines);

    expect(base).toBeInstanceOf(Decimal);
    expect(iva).toBeInstanceOf(Decimal);
    expect(total).toBeInstanceOf(Decimal);
    expect(typeof total).not.toBe("number");
  });

  it("lista vacía también devuelve instancias de Decimal", () => {
    const { base, iva } = invoiceBaseAndIva([]);
    expect(base).toBeInstanceOf(Decimal);
    expect(iva).toBeInstanceOf(Decimal);
    expect(invoiceTotalAmount([])).toBeInstanceOf(Decimal);
  });

  it("total === base + iva", () => {
    const lines = [
      ...luxuryPair("1333.33", "213.33", "200.00"),
      line("IVA_REDUCIDO", "100.10", "8.01"),
    ];
    const { base, iva } = invoiceBaseAndIva(lines);
    expect(invoiceTotalAmount(lines).equals(base.plus(iva))).toBe(true);
  });

  it("IEEE 754: 100.10 + 0.30 (bases exentas como number) = 100.4 exacto, no 100.39999999999999", () => {
    const lines = [line("EXENTO", 100.1, 0), line("EXENTO", 0.3, 0)];
    expect(invoiceBaseAndIva(lines).base.toString()).toBe("100.4");
    expect(invoiceTotalAmount(lines).toString()).toBe("100.4");
  });

  it("IEEE 754: 0.1 + 0.2 sumando bases exentas = 0.3 exacto, no 0.30000000000000004", () => {
    const lines = [line("EXENTO", 0.1, 0), line("EXENTO", 0.2, 0)];
    expect(invoiceBaseAndIva(lines).base.toString()).toBe("0.3");
    expect(invoiceTotalAmount(lines).toString()).toBe("0.3");
  });

  it("IEEE 754: 0.1 + 0.2 sumando IVA de dos líneas = 0.3 exacto", () => {
    const lines = [line("IVA_GENERAL", "1", 0.1), line("IVA_REDUCIDO", "1", 0.2)];
    expect(invoiceBaseAndIva(lines).iva.toString()).toBe("0.3");
  });

  it("no muta la lista de entrada (ni reordena)", () => {
    const original = luxuryPair("1000.00", "160.00", "150.00");
    const frozen = Object.freeze(original.map((l) => Object.freeze({ ...l })));
    const snapshot = JSON.stringify(frozen);

    expect(() => invoiceBaseAndIva(frozen as unknown as AmountTaxLine[])).not.toThrow();
    expect(() => invoiceTotalAmount(frozen as unknown as AmountTaxLine[])).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});

// ─── ARCH: el módulo debe ser PURO (se importa desde un componente cliente) ───

describe("invoice-amounts.ts — módulo puro (ARCH)", () => {
  const SRC_PATH = path.join(process.cwd(), "src/lib/invoice-amounts.ts");

  it("existe en la ruta acordada", () => {
    expect(fs.existsSync(SRC_PATH)).toBe(true);
  });

  it("solo importa decimal.js (sin prisma, sin @/lib/*, sin server-only ni 'use server')", () => {
    const source = fs.readFileSync(SRC_PATH, "utf8");

    // Todo `from "<spec>"` / `import "<spec>"` del archivo
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec).toBe("decimal.js");
    }

    expect(source).not.toMatch(/["']use server["']/);
    expect(source).not.toMatch(/server-only/);
    expect(source).not.toMatch(/@prisma\/client/);
  });

  it("exporta invoiceBaseAndIva e invoiceTotalAmount como funciones", () => {
    expect(typeof invoiceBaseAndIva).toBe("function");
    expect(typeof invoiceTotalAmount).toBe("function");
  });
});
