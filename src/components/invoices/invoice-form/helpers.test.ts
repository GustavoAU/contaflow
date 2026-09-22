// src/components/invoices/invoice-form/helpers.test.ts
//
// TDD SPEC (RED) — fix/iva-impreso-compras-ui
// `validateTaxLinesBeforeSubmit` cambia de firma: recibe un 3er argumento `docContext`
// ({ type, docType, currency }) y usa `ivaLineTolerance` (de "@/lib/invoice-amounts",
// ADR-049) en vez de exigir que `amount` sea EXACTAMENTE igual a base × tasa para TODAS
// las líneas. Hoy la función solo acepta 2 argumentos y sigue comparando por igualdad
// estricta sin importar el docContext — los tests marcados RED fallan contra ese código.
// No modificar este archivo para hacerlo pasar — implementar en helpers.ts.
import { describe, it, expect } from "vitest";
import { updateTaxLineState, validateTaxLinesBeforeSubmit } from "./helpers";
import type { TaxLine } from "./types";

const mkLine = (overrides: Partial<TaxLine> = {}): TaxLine => ({
  id: "line-1",
  taxType: "IVA_GENERAL",
  description: "",
  base: "1000",
  rate: "16",
  amount: "160.00", // calcAmount(1000, 16) = 160.00
  luxuryGroupId: null,
  ...overrides,
});

const PURCHASE_VES_FACTURA = { type: "PURCHASE", docType: "FACTURA", currency: "VES" };
const PURCHASE_USD_FACTURA = { type: "PURCHASE", docType: "FACTURA", currency: "USD" };
const SALE_VES_FACTURA = { type: "SALE", docType: "FACTURA", currency: "VES" };
const SALE_VES_REPORTE_Z = { type: "SALE", docType: "REPORTE_Z", currency: "VES" };
const SALE_USD_REPORTE_Z = { type: "SALE", docType: "REPORTE_Z", currency: "USD" };

describe("validateTaxLinesBeforeSubmit — tolerancia de IVA impreso (ADR-049) según docContext", () => {
  it("RED: compra VES, diferencia 0.50 (dentro de la tolerancia de 1.00) → acepta (null)", () => {
    const lines = [mkLine({ amount: "160.50" })]; // calc 160.00, diff 0.50
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_VES_FACTURA)).toBeNull();
  });

  it("compra VES, diferencia 1.01 (fuera de la tolerancia de 1.00) → rechaza", () => {
    const lines = [mkLine({ amount: "161.01" })]; // calc 160.00, diff 1.01
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_VES_FACTURA)).not.toBeNull();
  });

  it("RED: compra USD, diferencia 0.01 (borde exacto de la tolerancia estricta en divisa) → acepta (null)", () => {
    const lines = [mkLine({ amount: "160.01" })]; // calc 160.00, diff 0.01
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_USD_FACTURA)).toBeNull();
  });

  it("compra USD, diferencia 0.50 (fuera de la tolerancia de 0.01 en divisa) → rechaza", () => {
    const lines = [mkLine({ amount: "160.50" })];
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_USD_FACTURA)).not.toBeNull();
  });

  it("venta FACTURA, diferencia 0.50 → sigue rechazando (guarda: comportamiento estricto sin cambios)", () => {
    const lines = [mkLine({ amount: "160.50" })];
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", SALE_VES_FACTURA)).not.toBeNull();
  });

  it("RED: venta REPORTE_Z VES, diferencia 0.90 (dentro de la tolerancia amplia) → acepta (null)", () => {
    const lines = [mkLine({ amount: "160.90" })]; // calc 160.00, diff 0.90
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", SALE_VES_REPORTE_Z)).toBeNull();
  });

  it("venta REPORTE_Z USD, misma diferencia 0.90 → rechaza (moneda extranjera siempre estricta)", () => {
    const lines = [mkLine({ amount: "160.90" })];
    expect(validateTaxLinesBeforeSubmit(lines, "GRAVADA", SALE_USD_REPORTE_Z)).not.toBeNull();
  });
});

describe("validateTaxLinesBeforeSubmit — el resto de validaciones no cambia (docContext neutro: compra VES factura)", () => {
  it("par suntuario incompleto (IVA_ADICIONAL sin IVA_GENERAL) → rechaza", () => {
    const lines = [
      mkLine({ id: "a", taxType: "IVA_ADICIONAL", rate: "15", amount: "150.00", luxuryGroupId: "g1" }),
    ];
    const result = validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_VES_FACTURA);
    expect(result).not.toBeNull();
    expect(result).toMatch(/IVA General/);
  });

  it("bases desiguales entre IVA General e IVA Adicional vinculados → rechaza", () => {
    const lines = [
      mkLine({ id: "a", taxType: "IVA_GENERAL", base: "1000", rate: "16", amount: "160.00", luxuryGroupId: "g1" }),
      mkLine({ id: "b", taxType: "IVA_ADICIONAL", base: "900", rate: "15", amount: "135.00", luxuryGroupId: "g1" }),
    ];
    const result = validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_VES_FACTURA);
    expect(result).not.toBeNull();
    expect(result).toMatch(/bases/i);
  });

  it("categoría EXENTA con línea de IVA con base > 0 → rechaza", () => {
    // amount coherente con base×tasa a propósito: aísla el test a la validación de categoría,
    // no a la tolerancia.
    const lines = [mkLine({ amount: "160.00" })];
    const result = validateTaxLinesBeforeSubmit(lines, "EXENTA", PURCHASE_VES_FACTURA);
    expect(result).not.toBeNull();
    expect(result).toMatch(/exenta/i);
  });

  it("categoría GRAVADA sin ninguna base imponible > 0 → rechaza", () => {
    const lines = [mkLine({ base: "0", amount: "0.00" })];
    const result = validateTaxLinesBeforeSubmit(lines, "GRAVADA", PURCHASE_VES_FACTURA);
    expect(result).toBe("Debes ingresar al menos una base imponible mayor a cero.");
  });
});

// ─── updateTaxLineState — H1: no borrar un IVA impreso a mano al corregir la Base ──────────────
// TDD SPEC (RED) — fix/iva-impreso-compras-ui, hallazgo H1 de la revisión fiscal de ADR-049.
// En una línea editable (H2/ADR-049), corregir la Base después de teclear un Monto IVA impreso
// lo borra en silencio: la regla 5 (líneas normales) y la regla 3 (par de lujo sincronizado)
// SIEMPRE recalculan `amount = calcAmount(base, rate)` al cambiar `base`/`rate`, sin mirar si
// el usuario ya lo había desviado a mano. Antes de esta rama era inofensivo porque el campo
// siempre era readOnly = ese mismo cálculo; con H2 el campo puede ser editable y ya no lo es.
//
// Fix: antes de recalcular, comparar el `amount` ACTUAL de la línea contra `calcAmount` de los
// valores VIEJOS de base/rate (antes del cambio). Si coinciden ("auto-tracking": el usuario
// nunca lo desvió), se sigue recalculando como hoy. Si no coinciden (ya está desviado — "IVA
// impreso" tecleado a mano), se actualiza base/rate pero el amount NO se toca.
describe("updateTaxLineState — H1: no pisar un Monto IVA desviado a mano al cambiar Base/Tasa", () => {
  it("GUARDA: línea en auto-tracking (amount === calcAmount(base,rate)) → cambiar base sigue recalculando amount", () => {
    const prev = [mkLine({ base: "1000", rate: "16", amount: "160.00" })]; // calcAmount(1000,16) = 160.00
    const next = updateTaxLineState(prev, "line-1", "base", "2000");
    const updated = next.find((l) => l.id === "line-1")!;
    expect(updated.base).toBe("2000");
    expect(updated.amount).toBe("320.00"); // calcAmount(2000,16) — comportamiento sin cambios
  });

  it("RED: amount ya desviado a mano (IVA impreso, no coincide con calcAmount) → cambiar base NO toca amount", () => {
    const prev = [mkLine({ base: "1000", rate: "16", amount: "160.50" })]; // calcAmount(1000,16)=160.00 ≠ 160.50
    const next = updateTaxLineState(prev, "line-1", "base", "2000");
    const updated = next.find((l) => l.id === "line-1")!;
    expect(updated.base).toBe("2000");
    expect(updated.amount).toBe("160.50"); // hoy lo pisa con calcAmount("2000","16") = "320.00"
  });

  it("RED: amount ya desviado a mano → cambiar rate tampoco toca amount (consistencia, aunque hoy la UI no dispare esta rama)", () => {
    const prev = [mkLine({ base: "1000", rate: "16", amount: "160.50" })];
    const next = updateTaxLineState(prev, "line-1", "rate", "8");
    const updated = next.find((l) => l.id === "line-1")!;
    expect(updated.rate).toBe("8");
    expect(updated.amount).toBe("160.50"); // hoy lo pisa con calcAmount("1000","8") = "80.00"
  });

  it("GUARDA: par de lujo, ambas líneas en auto-tracking → cambiar la base de una sincroniza la base Y recalcula el amount de las DOS", () => {
    const general = mkLine({ id: "g", taxType: "IVA_GENERAL", base: "1000", rate: "16", amount: "160.00", luxuryGroupId: "grp-1" });
    const adicional = mkLine({ id: "a", taxType: "IVA_ADICIONAL", base: "1000", rate: "15", amount: "150.00", luxuryGroupId: "grp-1" });
    const prev = [general, adicional];
    const next = updateTaxLineState(prev, "g", "base", "2000");
    const nGeneral = next.find((l) => l.id === "g")!;
    const nAdicional = next.find((l) => l.id === "a")!;
    expect(nGeneral.base).toBe("2000");
    expect(nAdicional.base).toBe("2000");
    expect(nGeneral.amount).toBe("320.00"); // calcAmount(2000,16) — comportamiento sin cambios
    expect(nAdicional.amount).toBe("300.00"); // calcAmount(2000,15) — comportamiento sin cambios
  });

  it("RED: par de lujo con IVA_ADICIONAL ya desviado a mano → la base se sincroniza en AMBAS, pero solo se recalcula el amount de la que seguía en auto-tracking", () => {
    const general = mkLine({ id: "g", taxType: "IVA_GENERAL", base: "1000", rate: "16", amount: "160.00", luxuryGroupId: "grp-1" }); // auto-tracking
    const adicional = mkLine({ id: "a", taxType: "IVA_ADICIONAL", base: "1000", rate: "15", amount: "150.75", luxuryGroupId: "grp-1" }); // calcAmount(1000,15)=150.00 ≠ 150.75: desviado a mano
    const prev = [general, adicional];
    const next = updateTaxLineState(prev, "g", "base", "2000");
    const nGeneral = next.find((l) => l.id === "g")!;
    const nAdicional = next.find((l) => l.id === "a")!;
    expect(nGeneral.base).toBe("2000"); // la base siempre se espeja, sin excepción
    expect(nAdicional.base).toBe("2000");
    expect(nGeneral.amount).toBe("320.00"); // seguía en auto-tracking → se recalcula
    expect(nAdicional.amount).toBe("150.75"); // ya estaba desviado a mano → NO se toca (hoy lo pisa con calcAmount("2000","15")="300.00")
  });
});
