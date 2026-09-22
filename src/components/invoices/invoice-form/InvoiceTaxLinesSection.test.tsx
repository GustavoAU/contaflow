// @vitest-environment jsdom
// src/components/invoices/invoice-form/InvoiceTaxLinesSection.test.tsx
//
// TDD SPEC (RED) — fix/iva-impreso-compras-ui
// El campo "Monto IVA" debe volverse editable cuando `isIvaAmountEditable({ type, docType })`
// es true (cualquier compra, o venta REPORTE_Z/RESUMEN_VENTAS/PLANILLA_IMPORTACION/OTRO), y
// seguir readOnly (auto-calculado) en venta FACTURA/NOTA_CREDITO/NOTA_DEBITO.
// El componente actual NO recibe `type`/`docType` y el input de Monto IVA es SIEMPRE readOnly
// sin onChange: los tests marcados RED fallan contra ese código.
// No modificar este archivo para hacerlo pasar — implementar en InvoiceTaxLinesSection.tsx.
//
// Nota: este proyecto NO registra los matchers de @testing-library/jest-dom (no hay
// setupFiles en vitest.config.ts), así que se usa la propiedad DOM `.readOnly` con
// `toHaveProperty` — mismo patrón que InvoiceForm.test.tsx ("tasa siempre es readOnly").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InvoiceTaxLinesSection } from "./InvoiceTaxLinesSection";
import type { TaxLine } from "./types";

const LINE: TaxLine = {
  id: "line-1",
  taxType: "IVA_GENERAL",
  description: "",
  base: "1000",
  rate: "16",
  amount: "160.00",
  luxuryGroupId: null,
};

// Props NUEVAS `type`/`docType` no existen todavía en el tipo Props del componente —
// se usa `any` a propósito porque este archivo es la especificación de lo que debe aceptar.
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    taxLines: [LINE],
    taxCategory: "GRAVADA",
    currency: "VES",
    totalIva: "160.00",
    bcvLoading: false,
    bcvRate: null,
    addTaxLine: vi.fn(),
    removeTaxLine: vi.fn(),
    updateTaxLine: vi.fn(),
    hasAdditionalWithoutGeneral: () => false,
    type: "PURCHASE",
    docType: "FACTURA",
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function montoIvaInput(): HTMLInputElement {
  const label = screen.getByText("Monto IVA");
  const input = label.closest("div")?.querySelector("input");
  if (!input) throw new Error("No se encontró el input de Monto IVA junto a su label");
  return input as HTMLInputElement;
}

// Variante plural de `montoIvaInput`, necesaria cuando el formulario tiene VARIAS líneas: con
// más de una línea, "Monto IVA" aparece repetido y `getByText` (singular) lanzaría por
// ambigüedad. Devuelve los inputs en el mismo orden en que aparecen en el documento (idx 0 =
// primera línea, idx 1 = segunda línea, etc.) — usado por los tests H2 de editabilidad POR LÍNEA.
function montoIvaInputs(): HTMLInputElement[] {
  const labels = screen.getAllByText("Monto IVA");
  return labels.map((label) => {
    const input = label.closest("div")?.querySelector("input");
    if (!input) throw new Error("No se encontró el input de Monto IVA junto a su label");
    return input as HTMLInputElement;
  });
}

function tasaInput(): HTMLInputElement {
  return screen.getByDisplayValue("16%") as HTMLInputElement;
}

describe("InvoiceTaxLinesSection — Monto IVA editable según type/docType (ADR-049 UI)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RED: PURCHASE + FACTURA → Monto IVA es editable (sin readOnly) y dispara updateTaxLine", () => {
    const updateTaxLine = vi.fn();
    render(<InvoiceTaxLinesSection {...baseProps({ type: "PURCHASE", docType: "FACTURA", updateTaxLine })} />);

    const input = montoIvaInput();
    expect(input).toHaveProperty("readOnly", false);

    fireEvent.change(input, { target: { value: "160.50" } });
    expect(updateTaxLine).toHaveBeenCalledWith("line-1", "amount", "160.50");
  });

  it("RED: SALE + REPORTE_Z → Monto IVA es editable (sin readOnly) y dispara updateTaxLine", () => {
    const updateTaxLine = vi.fn();
    render(<InvoiceTaxLinesSection {...baseProps({ type: "SALE", docType: "REPORTE_Z", updateTaxLine })} />);

    const input = montoIvaInput();
    expect(input).toHaveProperty("readOnly", false);

    fireEvent.change(input, { target: { value: "160.90" } });
    expect(updateTaxLine).toHaveBeenCalledWith("line-1", "amount", "160.90");
  });

  it("SALE + FACTURA → Monto IVA sigue readOnly y no se puede editar (guarda: sin cambios)", () => {
    const updateTaxLine = vi.fn();
    render(<InvoiceTaxLinesSection {...baseProps({ type: "SALE", docType: "FACTURA", updateTaxLine })} />);

    const input = montoIvaInput();
    expect(input).toHaveProperty("readOnly", true);

    fireEvent.change(input, { target: { value: "160.50" } });
    expect(updateTaxLine).not.toHaveBeenCalled();
  });

  it("SALE + NOTA_CREDITO → Monto IVA sigue readOnly y no se puede editar (guarda: sin cambios)", () => {
    const updateTaxLine = vi.fn();
    render(<InvoiceTaxLinesSection {...baseProps({ type: "SALE", docType: "NOTA_CREDITO", updateTaxLine })} />);

    const input = montoIvaInput();
    expect(input).toHaveProperty("readOnly", true);

    fireEvent.change(input, { target: { value: "160.50" } });
    expect(updateTaxLine).not.toHaveBeenCalled();
  });

  it.each([
    ["PURCHASE", "FACTURA"],
    ["SALE", "REPORTE_Z"],
    ["SALE", "FACTURA"],
    ["SALE", "NOTA_CREDITO"],
  ] as const)("la Tasa de IVA sigue siempre readOnly (type=%s, docType=%s) — no cambia", (type, docType) => {
    render(<InvoiceTaxLinesSection {...baseProps({ type, docType })} />);
    expect(tasaInput()).toHaveProperty("readOnly", true);
  });
});

// ─── H2: la línea EXENTO nunca es editable, sin importar type/docType ─────────────────────────
// TDD SPEC (RED) — fix/iva-impreso-compras-ui, hallazgo H2 de la revisión fiscal de ADR-049.
// Hoy `montoIvaEditable = isIvaAmountEditable({ type, docType })` se calcula UNA VEZ para todo
// el documento (línea 41 del componente) y se aplica igual a TODAS las líneas, incluida EXENTO.
// El IVA de una línea EXENTO es siempre 0 — nunca "impreso" — así que jamás debe ser editable.
// El fix pasa a calcular la editabilidad POR LÍNEA, con `line.taxType` como 3er argumento de
// `isIvaAmountEditable`. Estos tests fallan contra el código actual (editabilidad global).
describe("InvoiceTaxLinesSection — H2: la línea EXENTO nunca es editable, sin importar type/docType (ADR-049, hallazgo H2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it('RED: PURCHASE + FACTURA + línea EXENTO → Monto IVA sigue readOnly (el IVA de una línea exenta nunca es "impreso")', () => {
    const updateTaxLine = vi.fn();
    const exentoLine: TaxLine = { ...LINE, id: "line-exento", taxType: "EXENTO", rate: "0", amount: "0.00" };
    render(
      <InvoiceTaxLinesSection
        {...baseProps({ type: "PURCHASE", docType: "FACTURA", updateTaxLine, taxLines: [exentoLine] })}
      />
    );

    const input = montoIvaInput();
    expect(input).toHaveProperty("readOnly", true);

    fireEvent.change(input, { target: { value: "999.00" } });
    expect(updateTaxLine).not.toHaveBeenCalled();
  });

  it("RED: PURCHASE + FACTURA con líneas mixtas (IVA_GENERAL editable + EXENTO no editable) → la editabilidad es POR LÍNEA, no global para todo el documento", () => {
    const updateTaxLine = vi.fn();
    const generalLine: TaxLine = { ...LINE, id: "line-general" };
    const exentoLine: TaxLine = { ...LINE, id: "line-exento", taxType: "EXENTO", rate: "0", amount: "0.00" };
    render(
      <InvoiceTaxLinesSection
        {...baseProps({
          type: "PURCHASE",
          docType: "FACTURA",
          updateTaxLine,
          taxLines: [generalLine, exentoLine],
        })}
      />
    );

    const [generalInput, exentoInput] = montoIvaInputs();

    expect(generalInput).toHaveProperty("readOnly", false);
    expect(exentoInput).toHaveProperty("readOnly", true);

    fireEvent.change(exentoInput, { target: { value: "999.00" } });
    expect(updateTaxLine).not.toHaveBeenCalled();

    fireEvent.change(generalInput, { target: { value: "160.50" } });
    expect(updateTaxLine).toHaveBeenCalledWith("line-general", "amount", "160.50");
  });
});
