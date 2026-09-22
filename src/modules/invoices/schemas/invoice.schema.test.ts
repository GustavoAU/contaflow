// src/modules/invoices/schemas/invoice.schema.test.ts
import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { getFiscalConfig } from "@/lib/countries";
import {
  CreateInvoiceSchema,
  CreateCreditDebitNoteSchema,
  getInvoiceSchemas,
} from "./invoice.schema";

// ─── Datos base para los tests ────────────────────────────────────────────────

const BASE_INVOICE = {
  companyId: "company-1",
  type: "PURCHASE" as const,
  invoiceNumber: "00000001",
  controlNumber: "00-00000001",
  date: new Date("2026-01-01"),
  counterpartName: "Proveedor S.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [],
  createdBy: "user-1",
};

const BASE_SALE = {
  companyId: "company-1",
  type: "SALE" as const,
  invoiceNumber: "00000001",
  date: new Date("2026-01-01"),
  counterpartName: "Cliente S.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [],
  createdBy: "user-1",
};

// ─── Tests RIF — Item 18.6 ────────────────────────────────────────────────────

describe("CreateInvoiceSchema — validación RIF (18.6)", () => {
  describe("RIFs válidos", () => {
    it("acepta J-12345678-9 (jurídico con dígito verificador)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "J-12345678-9",
      });
      expect(result.success).toBe(true);
    });

    it("rechaza V-87654321 (sin dígito verificador — ahora obligatorio)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "V-87654321",
      });
      expect(result.success).toBe(false);
    });

    it("acepta j-12345678-9 (lowercase — case insensitive)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "j-12345678-9",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RIFs inválidos", () => {
    it("rechaza '12345678' (sin prefijo)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "12345678",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });

    it("rechaza 'J-1234567' (solo 7 dígitos — requiere 8)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "J-1234567",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });

    it("rechaza 'X-12345678-9' (prefijo no permitido)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "X-12345678-9",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });
  });
});

// ─── Tests Nº Control — Bloque B Item 1 ──────────────────────────────────────

describe("CreateInvoiceSchema — validación Nº Control", () => {
  describe("PURCHASE — controlNumber obligatorio", () => {
    it("acepta 00-00000001 (formato correcto)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        controlNumber: "00-00000001",
      });
      expect(result.success).toBe(true);
    });

    it("rechaza PURCHASE sin controlNumber", () => {
      const { controlNumber: _removed, ...withoutControl } = BASE_INVOICE;
      const result = CreateInvoiceSchema.safeParse(withoutControl);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes("controlNumber"));
        expect(issue?.message).toContain("obligatorio en compras");
      }
    });

    it("rechaza controlNumber '12345678' (sin prefijo XX-)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        controlNumber: "12345678",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes("controlNumber"));
        expect(issue?.message).toContain("Formato: 00-00000001");
      }
    });

    it("rechaza controlNumber '00-0000001' (solo 7 dígitos)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        controlNumber: "00-0000001",
      });
      expect(result.success).toBe(false);
    });

    it("rechaza controlNumber '00-000000001' (9 dígitos — excede formato)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        controlNumber: "00-000000001",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SALE — controlNumber opcional", () => {
    it("acepta SALE sin controlNumber", () => {
      const result = CreateInvoiceSchema.safeParse(BASE_SALE);
      expect(result.success).toBe(true);
    });

    it("acepta SALE con controlNumber válido", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_SALE,
        controlNumber: "00-00000001",
      });
      expect(result.success).toBe(true);
    });
  });
});

// ─── Integridad del IVA (Z-2): monto de cada línea = round(base × tasa / 100) ─
//
// TDD SPEC (fix/iva-monto-base-tasa). Hueco verificado: `TaxLineSchema` solo valida
// rango y que la `rate` sea la canónica del `taxType`; nadie comprueba que el monto
// sea coherente con base × tasa. Hoy safeParse ACEPTA IVA_GENERAL base "1000.00",
// rate "16.00", amount "1.00" (o "0.00").
//
// Regla (decisión del dueño), a implementar en `create.superRefine` (necesita `type`
// y `docType`); `creditDebitNote` y `createWithLines` la heredan por `.extend()`:
//   esperado   = round(base × rate / 100, 2 decimales, ROUND_HALF_UP)   (Decimal.js)
//   diferencia = |amount − esperado|
//   tolerancia por línea (Bs.):
//     0.01 (estricta) → type === "SALE" y docType ∈ {FACTURA, NOTA_CREDITO, NOTA_DEBITO}
//     1.00            → todo lo demás: cualquier COMPRA (el IVA impreso por el proveedor
//                       manda), REPORTE_Z / RESUMEN_VENTAS / OTRO (impresora fiscal
//                       acumula redondeos) y PLANILLA_IMPORTACION
//   diferencia > tolerancia → issue en ["taxLines", i, "amount"]; el borde SE ACEPTA.
//
// Convención de la suite: los casos "rechaza" fallan HOY (RED, el schema acepta lo que
// debe rechazar); los "acepta" y las "regresiones" pasan hoy y deben seguir pasando
// (guardas). Todo el dinero viaja como string; los cálculos de borde usan Decimal.js.

type TaxType = "IVA_GENERAL" | "IVA_REDUCIDO" | "IVA_ADICIONAL" | "EXENTO";

// Alícuotas canónicas (%) del schema (ADR-006 D-3), escritas como las envía el cliente.
const CANONICAL_RATE: Record<TaxType, string> = {
  IVA_GENERAL: "16.00",
  IVA_REDUCIDO: "8.00",
  IVA_ADICIONAL: "15.00",
  EXENTO: "0.00",
};

const taxLineOf = (taxType: TaxType, base: string, amount: string) => ({
  taxType,
  base,
  rate: CANONICAL_RATE[taxType],
  amount,
});
const general = (base: string, amount: string) => taxLineOf("IVA_GENERAL", base, amount);
const reduced = (base: string, amount: string) => taxLineOf("IVA_REDUCIDO", base, amount);
const additional = (base: string, amount: string) => taxLineOf("IVA_ADICIONAL", base, amount);
const exempt = (base: string, amount: string) => taxLineOf("EXENTO", base, amount);

const saleDoc = (docType: string, taxLines: object[]) => ({ ...BASE_SALE, docType, taxLines });
const purchaseDoc = (docType: string, taxLines: object[]) => ({ ...BASE_INVOICE, docType, taxLines });
// El schema de notas exige la factura original; `CreateInvoiceSchema` ignora la clave extra.
const asNote = <T extends object>(doc: T) => ({ ...doc, relatedInvoiceId: "inv-original-1" });

// Forma mínima común a los schemas de factura (evita acoplar los helpers a los genéricos de Zod).
type Issue = { path: PropertyKey[]; message: string };
type Parsed = { success: true; data: unknown } | { success: false; error: { issues: Issue[] } };
type SchemaLike = { safeParse: (input: unknown) => Parsed };

/** Issues sobre el `amount` de una línea de impuesto: path ["taxLines", i, "amount"]. */
function ivaIssues(result: Parsed): Issue[] {
  if (result.success) return [];
  return result.error.issues.filter(
    (i) => i.path.length === 3 && i.path[0] === "taxLines" && i.path[2] === "amount",
  );
}

/** Rechazo por incoherencia de IVA: success:false y UN issue por cada índice de línea mala. */
function expectRejected(result: Parsed, atIndexes: number[] = [0]) {
  expect(result.success, "el schema debió rechazar el IVA incoherente con base × tasa").toBe(false);
  expect(ivaIssues(result).map((i) => i.path)).toEqual(atIndexes.map((n) => ["taxLines", n, "amount"]));
}

function expectAccepted(result: Parsed) {
  const detail = result.success
    ? ""
    : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ");
  expect(result.success, detail).toBe(true);
}

// El formato exacto del mensaje no está fijado ("p. ej."): se tolera "." o "," decimal y
// se exige que el número no sea parte de otro más largo (1.00 no debe casar con 11.00).
const money = (v: string) => new RegExp(`(?<!\\d)${v.replace(".", "[.,]")}(?!\\d)`);

describe("Integridad del IVA — monto de línea coherente con base × tasa (Z-2)", () => {
  // ── 1. VENTA FACTURA — estricta ─────────────────────────────────────────────
  describe("VENTA FACTURA — tolerancia estricta Bs. 0.01", () => {
    it.each([
      { amount: "160.00", why: "exacto" },
      { amount: "160.01", why: "borde superior (dif 0.01)" },
      { amount: "159.99", why: "borde inferior (dif 0.01)" },
    ])("acepta 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1000.00", amount)])));
    });

    it.each([
      { amount: "160.02", why: "dif 0.02 por encima" },
      { amount: "159.98", why: "dif 0.02 por debajo (valor absoluto)" },
      { amount: "1.00", why: "error grande" },
      { amount: "0.00", why: "IVA omitido" },
    ])("rechaza 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1000.00", amount)])));
    });

    it("el caso reportado (base 1000.00, rate 16.00, IVA 1.00) ya no se acepta", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.00", amount: "1.00" }]),
      );
      expectRejected(result);
    });

    it.each([
      { amount: "197.53", why: "exacto: 197.5296 redondea a 197.53" },
      { amount: "197.52", why: "borde inferior (dif 0.01)" },
      { amount: "197.54", why: "borde superior (dif 0.01 contra el esperado REDONDEADO; contra 197.5296 sería 0.0104)" },
    ])("acepta 1234.56 @16% con IVA $amount ($why)", ({ amount }) => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1234.56", amount)])));
    });

    it.each([
      { amount: "197.51", why: "dif 0.02" },
      { amount: "197.55", why: "dif 0.02" },
    ])("rechaza 1234.56 @16% con IVA $amount ($why)", ({ amount }) => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1234.56", amount)])));
    });
  });

  // ── 2. VENTA NOTA_CREDITO / NOTA_DEBITO — misma estrictez ───────────────────
  const noteSchemas: Array<{ name: string; schema: SchemaLike }> = [
    { name: "CreateCreditDebitNoteSchema", schema: CreateCreditDebitNoteSchema },
    { name: "CreateInvoiceSchema", schema: CreateInvoiceSchema },
  ];

  describe.each(noteSchemas)("VENTA NOTA_CREDITO / NOTA_DEBITO vía $name — tolerancia Bs. 0.01", ({ schema }) => {
    describe.each(["NOTA_CREDITO", "NOTA_DEBITO"])("%s", (docType) => {
      it.each([
        { amount: "160.00", why: "exacto" },
        { amount: "160.01", why: "borde superior" },
        { amount: "159.99", why: "borde inferior" },
      ])("acepta 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
        expectAccepted(schema.safeParse(asNote(saleDoc(docType, [general("1000.00", amount)]))));
      });

      it.each([
        { amount: "160.02", why: "dif 0.02" },
        { amount: "159.98", why: "dif 0.02 por debajo" },
        { amount: "1.00", why: "error grande" },
        { amount: "0.00", why: "IVA omitido" },
      ])("rechaza 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
        expectRejected(schema.safeParse(asNote(saleDoc(docType, [general("1000.00", amount)]))));
      });
    });
  });

  // ── 3. VENTA REPORTE_Z / RESUMEN_VENTAS / OTRO — impresora fiscal, 1.00 ─────
  describe.each(["REPORTE_Z", "RESUMEN_VENTAS", "OTRO"])(
    "VENTA %s — tolerancia Bs. 1.00 (la impresora fiscal acumula redondeos)",
    (docType) => {
      it.each([
        { amount: "160.00", why: "exacto" },
        { amount: "160.90", why: "dif 0.90" },
        { amount: "161.00", why: "borde superior (dif 1.00)" },
        { amount: "159.00", why: "borde inferior (dif 1.00)" },
      ])("acepta 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
        expectAccepted(CreateInvoiceSchema.safeParse(saleDoc(docType, [general("1000.00", amount)])));
      });

      it.each([
        { amount: "161.01", why: "dif 1.01" },
        { amount: "158.99", why: "dif 1.01 por debajo" },
        { amount: "0.00", why: "IVA omitido" },
      ])("rechaza 1000.00 @16% con IVA $amount ($why)", ({ amount }) => {
        expectRejected(CreateInvoiceSchema.safeParse(saleDoc(docType, [general("1000.00", amount)])));
      });
    },
  );

  describe("VENTA con docType fuera de la lista estricta (PLANILLA_IMPORTACION) → 'todo lo demás' = 1.00", () => {
    it("acepta el borde 161.00", () => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("PLANILLA_IMPORTACION", [general("1000.00", "161.00")])));
    });
    it("rechaza 161.01", () => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("PLANILLA_IMPORTACION", [general("1000.00", "161.01")])));
    });
  });

  // ── 4. COMPRA — el IVA impreso manda, tolerancia 1.00 ───────────────────────
  describe.each(["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO", "PLANILLA_IMPORTACION", "OTRO"])(
    "COMPRA %s — el IVA impreso manda, tolerancia Bs. 1.00",
    (docType) => {
      it.each([
        { amount: "160.00", why: "exacto" },
        { amount: "160.90", why: "IVA impreso con dif 0.90" },
        { amount: "161.00", why: "borde superior (dif 1.00)" },
        { amount: "159.00", why: "borde inferior (dif 1.00)" },
      ])("acepta 1000.00 @16% con IVA impreso $amount ($why)", ({ amount }) => {
        expectAccepted(CreateInvoiceSchema.safeParse(purchaseDoc(docType, [general("1000.00", amount)])));
      });

      it.each([
        { amount: "161.01", why: "dif 1.01" },
        { amount: "158.99", why: "dif 1.01 por debajo" },
        { amount: "1.00", why: "error grande" },
        { amount: "0.00", why: "IVA omitido" },
      ])("rechaza 1000.00 @16% con IVA impreso $amount ($why)", ({ amount }) => {
        expectRejected(CreateInvoiceSchema.safeParse(purchaseDoc(docType, [general("1000.00", amount)])));
      });
    },
  );

  describe("COMPRA vía el schema de notas (NOTA_CREDITO / NOTA_DEBITO de proveedor)", () => {
    it.each(["NOTA_CREDITO", "NOTA_DEBITO"])("%s: acepta IVA impreso 160.90 y el borde 161.00", (docType) => {
      expectAccepted(CreateCreditDebitNoteSchema.safeParse(asNote(purchaseDoc(docType, [general("1000.00", "160.90")]))));
      expectAccepted(CreateCreditDebitNoteSchema.safeParse(asNote(purchaseDoc(docType, [general("1000.00", "161.00")]))));
    });
    it.each(["NOTA_CREDITO", "NOTA_DEBITO"])("%s: rechaza 161.01", (docType) => {
      expectRejected(CreateCreditDebitNoteSchema.safeParse(asNote(purchaseDoc(docType, [general("1000.00", "161.01")]))));
    });
  });

  it("COMPRA: el IVA impreso aceptado se conserva TAL CUAL (no se reemplaza por base × tasa)", () => {
    const result = CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [general("1000.00", "160.90")]));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.taxLines).toHaveLength(1);
      expect(result.data.taxLines[0].amount).toBe("160.90");
      expect(result.data.taxLines[0].base).toBe("1000.00");
    }
  });

  // ── Redondeo ROUND_HALF_UP y precisión Decimal (IEEE 754) ───────────────────
  describe("redondeo ROUND_HALF_UP y precisión Decimal (IEEE 754)", () => {
    // `expected` es el IVA correcto escrito a mano (no recalculado en el test).
    const ROWS: Array<{ base: string; taxType: TaxType; expected: string; why: string }> = [
      { base: "1234.56", taxType: "IVA_GENERAL", expected: "197.53", why: "197.5296 sube" },
      { base: "100.10", taxType: "IVA_GENERAL", expected: "16.02", why: "16.016; con Number 16.03-16.02 = 0.010000000000001563 > 0.01" },
      { base: "1333.33", taxType: "IVA_GENERAL", expected: "213.33", why: "213.3328 baja" },
      { base: "100.30", taxType: "IVA_ADICIONAL", expected: "15.05", why: "15.045 es empate: HALF_UP da 15.05 (Number da 15.044999999999998 y HALF_EVEN 15.04)" },
      { base: "787430.00", taxType: "IVA_REDUCIDO", expected: "62994.40", why: "exacto; con Number 62994.41-62994.40 = 0.010000000002037268 > 0.01" },
      { base: "9999999.99", taxType: "IVA_GENERAL", expected: "1600000.00", why: "1599999.9984 sube a 1600000.00" },
    ];
    const REGIMES: Array<{ name: string; tol: string; build: (line: object) => object }> = [
      { name: "VENTA FACTURA", tol: "0.01", build: (line) => saleDoc("FACTURA", [line]) },
      { name: "COMPRA FACTURA", tol: "1.00", build: (line) => purchaseDoc("FACTURA", [line]) },
    ];

    describe.each(REGIMES)("$name (tolerancia $tol)", ({ tol, build }) => {
      it.each(ROWS)("acepta el esperado y sus dos bordes: $base @ $taxType → $expected ($why)", ({ base, taxType, expected }) => {
        const at = (amount: string) => CreateInvoiceSchema.safeParse(build(taxLineOf(taxType, base, amount)));
        expectAccepted(at(expected));
        expectAccepted(at(new Decimal(expected).plus(tol).toFixed(2)));
        const down = new Decimal(expected).minus(tol);
        if (!down.isNegative()) expectAccepted(at(down.toFixed(2)));
      });

      it.each(ROWS)("rechaza un centavo más allá de cada borde: $base @ $taxType → $expected", ({ base, taxType, expected }) => {
        const at = (amount: string) => CreateInvoiceSchema.safeParse(build(taxLineOf(taxType, base, amount)));
        expectRejected(at(new Decimal(expected).plus(tol).plus("0.01").toFixed(2)));
        const belowDown = new Decimal(expected).minus(tol).minus("0.01");
        if (!belowDown.isNegative()) expectRejected(at(belowDown.toFixed(2)));
      });
    });
  });

  // ── 5. Alícuotas: reducido 8 %, adicional 15 %, exento ──────────────────────
  describe("IVA_REDUCIDO 8% (base 787430.00 → 62994.40)", () => {
    it.each(["62994.40", "62994.41", "62994.39"])("VENTA FACTURA acepta IVA %s", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [reduced("787430.00", amount)])));
    });
    it.each([
      { amount: "62994.42", why: "dif 0.02" },
      { amount: "62994.38", why: "dif 0.02 por debajo" },
      { amount: "6299.44", why: "coma decimal corrida un lugar" },
      { amount: "0.00", why: "IVA omitido" },
    ])("VENTA FACTURA rechaza IVA $amount ($why)", ({ amount }) => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [reduced("787430.00", amount)])));
    });
    it.each(["62994.40", "62995.40", "62993.40"])("COMPRA acepta IVA impreso %s", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [reduced("787430.00", amount)])));
    });
    it.each(["62995.41", "62993.39", "6299.44"])("COMPRA rechaza IVA impreso %s", (amount) => {
      expectRejected(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [reduced("787430.00", amount)])));
    });
  });

  describe("IVA_ADICIONAL 15% (base 1000.00 → 150.00)", () => {
    it.each(["150.00", "150.01", "149.99"])("VENTA FACTURA acepta IVA %s", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [additional("1000.00", amount)])));
    });
    it.each([
      { amount: "150.02", why: "dif 0.02" },
      { amount: "149.98", why: "dif 0.02 por debajo" },
      { amount: "310.00", why: "31% total aplicado por error a la línea adicional" },
      { amount: "0.00", why: "IVA omitido" },
    ])("VENTA FACTURA rechaza IVA $amount ($why)", ({ amount }) => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [additional("1000.00", amount)])));
    });
    it.each(["150.00", "151.00", "149.00"])("COMPRA acepta IVA impreso %s", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [additional("1000.00", amount)])));
    });
    it.each(["151.01", "148.99"])("COMPRA rechaza IVA impreso %s", (amount) => {
      expectRejected(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [additional("1000.00", amount)])));
    });
  });

  describe("EXENTO (rate 0 → esperado 0.00, misma tolerancia)", () => {
    it("VENTA FACTURA acepta IVA 0.00", () => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [exempt("500.00", "0.00")])));
    });
    it("VENTA FACTURA acepta el borde 0.01", () => {
      expectAccepted(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [exempt("500.00", "0.01")])));
    });
    it.each(["0.02", "0.50"])("VENTA FACTURA rechaza IVA %s en una línea exenta", (amount) => {
      expectRejected(CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [exempt("500.00", amount)])));
    });
    it.each(["0.00", "0.50", "1.00"])("COMPRA acepta IVA impreso %s en una línea exenta", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [exempt("500.00", amount)])));
    });
    it("COMPRA rechaza IVA impreso 1.01 en una línea exenta", () => {
      expectRejected(CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [exempt("500.00", "1.01")])));
    });
  });

  // ── 6. Varias líneas — el issue apunta a la línea mala ──────────────────────
  describe("varias líneas de impuesto", () => {
    it("una buena y una mala → un solo issue, en el índice de la mala, con los montos", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [general("1000.00", "160.00"), reduced("500.00", "45.00")]),
      );
      expectRejected(result, [1]);
      const [issue] = ivaIssues(result);
      expect(issue.message).toMatch(money("45.00")); // recibido
      expect(issue.message).toMatch(money("40.00")); // esperado: 500 × 8 %
    });

    it("una mala y una buena → el issue apunta al índice 0", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [general("1000.00", "100.00"), reduced("500.00", "40.00")]),
      );
      expectRejected(result, [0]);
    });

    it("buena, mala, buena → un solo issue en el índice 1", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [general("1000.00", "160.00"), reduced("500.00", "45.00"), exempt("300.00", "0.00")]),
      );
      expectRejected(result, [1]);
    });

    it("dos malas → dos issues, cada uno con sus propios montos", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [general("1000.00", "100.00"), reduced("500.00", "45.00")]),
      );
      expectRejected(result, [0, 1]);
      const [first, second] = ivaIssues(result);
      expect(first.message).toMatch(money("100.00"));
      expect(first.message).toMatch(money("160.00"));
      expect(second.message).toMatch(money("45.00"));
      expect(second.message).toMatch(money("40.00"));
    });

    it("factura de lujo correcta (GENERAL 160.00 + ADICIONAL 150.00 sobre la misma base) se acepta", () => {
      expectAccepted(
        CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1000.00", "160.00"), additional("1000.00", "150.00")])),
      );
    });

    it("factura de lujo con el 31% puesto en la línea adicional → rechaza SOLO esa línea (índice 1)", () => {
      expectRejected(
        CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1000.00", "160.00"), additional("1000.00", "310.00")])),
        [1],
      );
    });

    it("COMPRA con dos líneas impresas dentro de 1.00 (160.90 y 40.80) se acepta", () => {
      expectAccepted(
        CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [general("1000.00", "160.90"), reduced("500.00", "40.80")])),
      );
    });

    it("COMPRA: si la segunda línea excede 1.00 (41.01 contra 40.00), el issue va al índice 1", () => {
      expectRejected(
        CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [general("1000.00", "160.90"), reduced("500.00", "41.01")])),
        [1],
      );
    });
  });

  // ── Mensaje del issue ───────────────────────────────────────────────────────
  describe("mensaje del issue", () => {
    it("VENTA FACTURA: incluye el monto recibido, el esperado (base × tasa) y la tolerancia 0.01", () => {
      const result = CreateInvoiceSchema.safeParse(saleDoc("FACTURA", [general("1000.00", "12.34")]));
      expectRejected(result);
      const [issue] = ivaIssues(result);
      expect(issue.message).toMatch(/IVA/);
      expect(issue.message).toMatch(money("12.34"));
      expect(issue.message).toMatch(money("160.00"));
      expect(issue.message).toMatch(money("0.01"));
      expect(issue.message).not.toMatch(money("1.00")); // no anuncia la tolerancia de otro régimen
    });

    it("COMPRA: incluye el monto recibido, el esperado y la tolerancia 1.00", () => {
      const result = CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [general("1000.00", "12.34")]));
      expectRejected(result);
      const [issue] = ivaIssues(result);
      expect(issue.message).toMatch(money("12.34"));
      expect(issue.message).toMatch(money("160.00"));
      expect(issue.message).toMatch(money("1.00"));
      expect(issue.message).not.toMatch(money("0.01"));
    });

    it("VENTA REPORTE_Z: la tolerancia del mensaje es 1.00", () => {
      const result = CreateInvoiceSchema.safeParse(saleDoc("REPORTE_Z", [general("1000.00", "12.34")]));
      expectRejected(result);
      const [issue] = ivaIssues(result);
      expect(issue.message).toMatch(money("1.00"));
      expect(issue.message).not.toMatch(money("0.01"));
    });
  });

  // ── 7. Regresiones que deben SEGUIR pasando ─────────────────────────────────
  describe("regresiones (deben seguir pasando)", () => {
    it.each([
      { name: "VENTA FACTURA", doc: saleDoc("FACTURA", [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "15.00", amount: "150.00" }]) },
      { name: "COMPRA FACTURA", doc: purchaseDoc("FACTURA", [{ taxType: "IVA_REDUCIDO", base: "1000.00", rate: "16.00", amount: "160.00" }]) },
    ])("$name: una tasa no canónica sigue rechazándose en ['taxLines', 0, 'rate'] (aunque el monto cuadre con ella)", ({ doc }) => {
      const result = CreateInvoiceSchema.safeParse(doc);
      expect(result.success).toBe(false);
      if (!result.success) {
        const rateIssue = result.error.issues.find(
          (i) => i.path.length === 3 && i.path[0] === "taxLines" && i.path[1] === 0 && i.path[2] === "rate",
        );
        expect(rateIssue?.message).toMatch(/^Tasa inválida para IVA_(GENERAL|REDUCIDO): debe ser (16|8)%$/);
      }
    });

    it("mensaje exacto de tasa no canónica para IVA_GENERAL", () => {
      const result = CreateInvoiceSchema.safeParse(
        saleDoc("FACTURA", [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "15.00", amount: "150.00" }]),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const rateIssue = result.error.issues.find((i) => i.path[2] === "rate");
        expect(rateIssue?.message).toBe("Tasa inválida para IVA_GENERAL: debe ser 16%");
      }
    });

    it.each(["16", "16.00", "16.0"])("la tasa canónica escrita como '%s' se sigue aceptando con IVA 160.00", (rate) => {
      expectAccepted(
        CreateInvoiceSchema.safeParse(
          saleDoc("FACTURA", [{ taxType: "IVA_GENERAL", base: "1000.00", rate, amount: "160.00" }]),
        ),
      );
    });

    it("una factura de venta correcta (general + reducido + exento) se sigue aceptando", () => {
      expectAccepted(
        CreateInvoiceSchema.safeParse(
          saleDoc("FACTURA", [general("1000.00", "160.00"), reduced("500.00", "40.00"), exempt("300.00", "0.00")]),
        ),
      );
    });

    it("una factura de compra correcta (con Nº de control) se sigue aceptando", () => {
      expectAccepted(
        CreateInvoiceSchema.safeParse(purchaseDoc("FACTURA", [general("1000.00", "160.00"), reduced("500.00", "40.00")])),
      );
    });

    it.each([
      { name: "VENTA", doc: saleDoc("FACTURA", []) },
      { name: "COMPRA", doc: purchaseDoc("FACTURA", []) },
    ])("$name con taxLines: [] se sigue aceptando (no hay nada que comparar)", ({ doc }) => {
      expectAccepted(CreateInvoiceSchema.safeParse(doc));
    });

    it("compra sin Nº de control + IVA incoherente → se reportan AMBOS issues (validaciones independientes)", () => {
      const { controlNumber: _removed, ...withoutControl } = BASE_INVOICE;
      const result = CreateInvoiceSchema.safeParse({
        ...withoutControl,
        docType: "FACTURA",
        taxLines: [general("1000.00", "12.34")],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("controlNumber"))).toBe(true);
      }
      expectRejected(result); // el issue de IVA en ["taxLines", 0, "amount"] no lo tapa el del Nº de control
    });
  });

  // ── Robustez: valores malformados no deben LANZAR dentro del superRefine ────
  // Un `new Decimal("abc")` sin guardia lanza DecimalError y `safeParse` propaga la
  // excepción. Los refinamientos del objeto padre corren aunque un campo hijo ya haya
  // dado un issue "continuable" (min(1), refine de rango), así que llegan strings raros.
  describe("valores malformados: se rechazan SIN lanzar excepción", () => {
    const MALFORMED = [
      { field: "amount", value: "" },
      { field: "amount", value: "abc" },
      { field: "amount", value: "1e3" },
      { field: "amount", value: "0x64" },
      { field: "amount", value: "NaN" },
      { field: "amount", value: "Infinity" },
      { field: "base", value: "" },
      { field: "base", value: "abc" },
      { field: "base", value: "1e3" },
      { field: "rate", value: "" },
      { field: "rate", value: "abc" },
    ];
    const DOCS: Array<{ name: string; build: (line: object) => object }> = [
      { name: "VENTA FACTURA", build: (line) => saleDoc("FACTURA", [line]) },
      { name: "COMPRA FACTURA", build: (line) => purchaseDoc("FACTURA", [line]) },
    ];

    describe.each(DOCS)("$name", ({ build }) => {
      it.each(MALFORMED)("$field = '$value'", ({ field, value }) => {
        const doc = build({ ...general("1000.00", "160.00"), [field]: value });
        const run = () => CreateInvoiceSchema.safeParse(doc);
        expect(run).not.toThrow();
        expect(run().success).toBe(false);
      });
    });
  });

  // El refine del padre corre aunque un hijo ya fallara: sin tope, una base de miles de dígitos haría calcular
  // base × tasa y devolver un mensaje del tamaño del número.
  describe("tope de tamaño (ADR-049)", () => {
    it("una base de 5000 dígitos se rechaza por rango, sin evaluar el IVA ni generar un mensaje enorme", () => {
      const doc = saleDoc("FACTURA", [{ ...general("1000.00", "160.00"), base: "9".repeat(5000) }]);
      const run = () => CreateInvoiceSchema.safeParse(doc);

      expect(run).not.toThrow();
      const result = run();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.every((i) => i.message.length < 300)).toBe(true);
        expect(result.error.issues.some((i) => /no coincide con base × tasa/.test(i.message))).toBe(false);
      }
    });

    it("un monto de 5000 dígitos y una tasa desmesurada tampoco generan mensajes enormes", () => {
      const doc = saleDoc("FACTURA", [{ ...general("1000.00", "160.00"), amount: "9".repeat(5000), rate: "1".repeat(5000) }]);
      const result = CreateInvoiceSchema.safeParse(doc);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.every((i) => i.message.length < 300)).toBe(true);
    });
  });

  // ── Misma regla vía la fábrica por país (así la usan las actions) ───────────
  // createInvoiceAction / createCreditNoteAction / createDebitNoteAction llaman
  // getInvoiceSchemas(getFiscalConfig(ctx.country)).create | .creditDebitNote
  describe("vía getInvoiceSchemas(getFiscalConfig('VEN')) — como las actions", () => {
    const schemas = getInvoiceSchemas(getFiscalConfig("VEN"));

    it("create: rechaza VENTA FACTURA con IVA incoherente", () => {
      expectRejected(schemas.create.safeParse(saleDoc("FACTURA", [general("1000.00", "1.00")])));
    });
    it("create: acepta VENTA FACTURA con el IVA correcto", () => {
      expectAccepted(schemas.create.safeParse(saleDoc("FACTURA", [general("1000.00", "160.00")])));
    });

    it("creditDebitNote: rechaza VENTA NOTA_CREDITO con IVA incoherente", () => {
      expectRejected(schemas.creditDebitNote.safeParse(asNote(saleDoc("NOTA_CREDITO", [general("1000.00", "1.00")]))));
    });
    it("creditDebitNote: acepta VENTA NOTA_CREDITO con el IVA correcto", () => {
      expectAccepted(schemas.creditDebitNote.safeParse(asNote(saleDoc("NOTA_CREDITO", [general("1000.00", "160.00")]))));
    });

    it("createWithLines: hereda la regla — rechaza VENTA FACTURA con IVA incoherente", () => {
      expectRejected(schemas.createWithLines.safeParse(saleDoc("FACTURA", [general("1000.00", "1.00")])));
    });
    it("createWithLines: acepta VENTA FACTURA con el IVA correcto", () => {
      expectAccepted(schemas.createWithLines.safeParse(saleDoc("FACTURA", [general("1000.00", "160.00")])));
    });

    it("create: COMPRA con IVA impreso 160.90 se acepta", () => {
      expectAccepted(schemas.create.safeParse(purchaseDoc("FACTURA", [general("1000.00", "160.90")])));
    });
    it("create: COMPRA con IVA impreso 161.01 se rechaza", () => {
      expectRejected(schemas.create.safeParse(purchaseDoc("FACTURA", [general("1000.00", "161.01")])));
    });
  });
});

// ─── ADR-049 — huecos de la revisión fiscal (TDD SPEC: RED primero) ───────────────────────────────
//
// La revisión fiscal encontró tres huecos en la regla "el IVA de cada línea cuadra con base × tasa":
//
//   A) `taxLine.superRefine` compara la `rate` por VALOR (`new Decimal(rate).eq(canónica)`), así que "1.6e1",
//      "0x10", "0b10000", "1_6" y "16.0000000000000" valen 16 para decimal.js y se aceptaban. Ahora la `rate` debe
//      ser decimal llano (`isPlainDecimal` de @/lib/zod-helpers) de MÁXIMO 12 caracteres, y base × tasa se calcula
//      SIEMPRE con la alícuota canónica del taxType (la del servidor), nunca con el string del cliente.
//   B) Los montos llegan en la MONEDA DEL DOCUMENTO. "Máximo Bs. 1,00" no tiene sentido en USD/EUR (1,00 USD equivale
//      a ~Bs. 549): con `currency !== "VES"` se usa SIEMPRE la tolerancia estricta 0,01 (la unidad mínima de la
//      moneda), también en compras y en REPORTE_Z / RESUMEN_VENTAS / OTRO, y el mensaje nombra la moneda, no "Bs.".
//   C) NC/ND: la action ignora el docType que declara el cliente → ver invoice.actions.test.ts.
//
// Convención (igual que la suite de arriba): los "rechaza" nuevos fallan HOY (RED); las guardas ("acepta", regresiones
// y los rechazos que decimal.js ya provoca por sí solo: "abc", " 16", "16 ") pasan hoy y deben seguir pasando.

/** Issues sobre la `rate` de una línea de impuesto: path ["taxLines", i, "rate"]. */
function rateIssues(result: Parsed): Issue[] {
  if (result.success) return [];
  return result.error.issues.filter(
    (i) => i.path.length === 3 && i.path[0] === "taxLines" && i.path[2] === "rate",
  );
}

/**
 * Rechazo por `rate` mal escrita: success:false, UN issue por índice en ["taxLines", i, "rate"] cuyo mensaje habla de la
 * "tasa", y el PRIMER issue del resultado es el de la tasa (el usuario ve la causa raíz, no su efecto sobre el monto).
 */
function expectRateRejected(result: Parsed, atIndexes: number[] = [0]) {
  expect(result.success, "el schema debió rechazar la rate mal escrita").toBe(false);
  if (result.success) return;
  const issues = rateIssues(result);
  expect(issues.map((i) => i.path)).toEqual(atIndexes.map((n) => ["taxLines", n, "rate"]));
  for (const issue of issues) expect(issue.message).toMatch(/tasa/i);
  expect(result.error.issues[0].path).toEqual(["taxLines", atIndexes[0], "rate"]);
}

/**
 * Rechazo por IVA incoherente CON el mensaje comprobado: además del path (`expectRejected`), cada issue de IVA habla del
 * IVA y de la discrepancia "base × tasa" y, si se indican `amounts`, el primero trae el monto recibido y el esperado
 * (calculado con la alícuota canónica del servidor).
 */
function expectIvaRejected(result: Parsed, atIndexes: number[] = [0], amounts?: { received: string; expected: string }) {
  expectRejected(result, atIndexes);
  const issues = ivaIssues(result);
  for (const issue of issues) {
    expect(issue.message).toMatch(/IVA/);
    expect(issue.message).toMatch(/base × tasa/);
  }
  if (amounts) {
    expect(issues[0].message).toMatch(money(amounts.received));
    expect(issues[0].message).toMatch(money(amounts.expected));
  }
}

// Todos los documentos de la sección A se prueban como VENTA FACTURA (0.01) y como COMPRA FACTURA (1.00).
const RATE_DOCS: Array<{ name: string; build: (lines: object[]) => object }> = [
  { name: "VENTA FACTURA", build: (lines) => saleDoc("FACTURA", lines) },
  { name: "COMPRA FACTURA", build: (lines) => purchaseDoc("FACTURA", lines) },
];

// Formas de escribir la alícuota que decimal.js lee como el MISMO número que la canónica pero que NO son decimal llano
// (o pasan de 12 caracteres). `coherent` es el IVA que cuadra con la alícuota canónica sobre `base`.
const MISWRITTEN_RATES: Array<{
  taxType: TaxType;
  base: string;
  coherent: string;
  rates: Array<{ rate: string; why: string }>;
}> = [
  {
    taxType: "IVA_GENERAL",
    base: "1000.00",
    coherent: "160.00",
    rates: [
      { rate: "1.6e1", why: "notación científica" },
      { rate: "0x10", why: "hexadecimal" },
      { rate: "0b10000", why: "binario" },
      { rate: "16.0000000000000", why: "ceros de relleno: pasa de 12 caracteres" },
      { rate: "1_6", why: "separador de guion bajo" },
      { rate: "abc", why: "no numérica" },
      { rate: " 16", why: "espacio inicial" },
      { rate: "16 ", why: "espacio final" },
    ],
  },
  {
    taxType: "IVA_REDUCIDO",
    base: "1000.00",
    coherent: "80.00",
    rates: [
      { rate: "0.8e1", why: "notación científica" },
      { rate: "0x8", why: "hexadecimal" },
      { rate: "8.0000000000000", why: "ceros de relleno: pasa de 12 caracteres" },
      { rate: " 8", why: "espacio inicial" },
    ],
  },
  {
    taxType: "IVA_ADICIONAL",
    base: "1000.00",
    coherent: "150.00",
    rates: [
      { rate: "1.5e1", why: "notación científica" },
      { rate: "0xF", why: "hexadecimal" },
      { rate: "15.0000000000000", why: "ceros de relleno: pasa de 12 caracteres" },
      { rate: "15 ", why: "espacio final" },
    ],
  },
  {
    taxType: "EXENTO",
    base: "1000.00",
    coherent: "0.00",
    rates: [
      { rate: "0e0", why: "notación científica" },
      { rate: "0x0", why: "hexadecimal" },
      { rate: "0.0000000000000", why: "ceros de relleno: pasa de 12 caracteres" },
      { rate: " 0", why: "espacio inicial" },
    ],
  },
];

// Escrituras planas de la alícuota canónica que HOY ya se aceptan y deben seguir aceptándose (comprobado corriendo el
// test antes de fijarlas). `rate.padEnd(12, "0")` es el borde: exactamente 12 caracteres.
const PLAIN_RATES: Array<{ taxType: TaxType; base: string; amount: string; rates: string[] }> = [
  { taxType: "IVA_GENERAL", base: "1000.00", amount: "160.00", rates: ["16", "16.00", "016", "+16", "16.", "16.".padEnd(12, "0")] },
  { taxType: "IVA_REDUCIDO", base: "1000.00", amount: "80.00", rates: ["8", "8.00", "08", "+8", "8.", "8.".padEnd(12, "0")] },
  { taxType: "IVA_ADICIONAL", base: "1000.00", amount: "150.00", rates: ["15", "15.00", "015", "+15", "15.", "15.".padEnd(12, "0")] },
  { taxType: "EXENTO", base: "1000.00", amount: "0.00", rates: ["0", "0.00", "00", "+0", "0.", "0.".padEnd(12, "0")] },
];

describe("ADR-049 hueco A — la rate debe ser decimal llano de máximo 12 caracteres", () => {
  // ── A.1 Rechazo de la rate mal escrita, con el IVA coherente y con el incoherente ──────────────
  describe.each(RATE_DOCS)("A.1 rechazo — $name", ({ build }) => {
    describe.each(MISWRITTEN_RATES)("$taxType", ({ taxType, base, coherent, rates }) => {
      it.each(rates)("rechaza rate $rate ($why) aunque el IVA sea coherente", ({ rate }) => {
        const result = CreateInvoiceSchema.safeParse(build([{ taxType, base, rate, amount: coherent }]));
        expectRateRejected(result);
        // El monto SÍ cuadra con la alícuota canónica: la rate es la única causa del rechazo (un solo issue en el path rate).
        expect(ivaIssues(result)).toEqual([]);
      });

      it.each(rates)("rechaza rate $rate ($why) con IVA 1.00", ({ rate }) => {
        expectRateRejected(CreateInvoiceSchema.safeParse(build([{ taxType, base, rate, amount: "1.00" }])));
      });
    });

    it("la rate mal escrita en la SEGUNDA línea → el issue de la tasa apunta al índice 1", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([general("1000.00", "160.00"), { ...reduced("500.00", "40.00"), rate: "0.8e1" }]),
      );
      expectRateRejected(result, [1]);
      expect(ivaIssues(result)).toEqual([]); // 500.00 x 8 % = 40.00 cuadra con la alícuota canónica
    });

    it("dos líneas con la rate mal escrita → un issue de tasa por línea, el primero en el índice 0", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ ...general("1000.00", "160.00"), rate: "1.6e1" }, { ...reduced("500.00", "40.00"), rate: "0x8" }]),
      );
      expectRateRejected(result, [0, 1]);
    });

    it("una rate de 5000 caracteres se rechaza en el path rate SIN copiar el valor en el mensaje", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "1".repeat(5000), amount: "160.00" }]),
      );
      expectRateRejected(result);
      if (!result.success) expect(rateIssues(result)[0].message.length).toBeLessThan(300);
    });
  });

  // ── A.1 (borde) Más de 12 caracteres se rechaza aunque valga exactamente lo mismo ───────────────
  describe.each(RATE_DOCS)("A.1 borde de longitud — $name", ({ build }) => {
    it.each(PLAIN_RATES)("$taxType: una rate de 13 caracteres (el borde de 12 + un cero más) se rechaza", ({ taxType, base, amount, rates }) => {
      const atLimit = rates[rates.length - 1]; // la última fila de PLAIN_RATES es la de exactamente 12 caracteres
      expect(atLimit).toHaveLength(12);
      const rate = atLimit + "0";
      expect(rate).toHaveLength(13);
      expectRateRejected(CreateInvoiceSchema.safeParse(build([{ taxType, base, rate, amount }])));
    });
  });

  // ── A.2 Lo que hoy se acepta SIGUE aceptándose (con el IVA coherente) ────────────────────────────
  describe.each(RATE_DOCS)("A.2 aceptación — $name", ({ build }) => {
    describe.each(PLAIN_RATES)("$taxType", ({ taxType, base, amount, rates }) => {
      it.each(rates)("acepta la rate plana '%s' con el IVA coherente", (rate) => {
        expectAccepted(CreateInvoiceSchema.safeParse(build([{ taxType, base, rate, amount }])));
      });
    });

    it("el borde de 12 caracteres ('16.000000000') mide exactamente 12", () => {
      expect("16.000000000").toHaveLength(12);
      expectAccepted(
        CreateInvoiceSchema.safeParse(
          build([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.000000000", amount: "160.00" }]),
        ),
      );
    });
  });

  // ── A.3 base × tasa se calcula con la alícuota CANÓNICA del taxType, no con el string del cliente ─
  describe.each(RATE_DOCS)("A.3 alícuota canónica — $name", ({ build }) => {
    it("IVA_GENERAL con rate plana pero no canónica (16.5) y monto coherente con ESA rate (165.00): issue en la tasa Y en el monto, y el primero es el de la tasa", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.5", amount: "165.00" }]),
      );
      expectRateRejected(result); // incluye: issues[0] es el de ["taxLines", 0, "rate"]
      // y hay UN issue en ["taxLines", 0, "amount"]: recibido 165.00; esperado 160.00 con la alícuota del SERVIDOR (16 %),
      // no 165.00 (el 16,5 % que escribió el cliente)
      expectIvaRejected(result, [0], { received: "165.00", expected: "160.00" });
    });

    it("el mensaje de la tasa sigue siendo el de la alícuota canónica y sale PRIMERO", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.5", amount: "165.00" }]),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["taxLines", 0, "rate"]);
        expect(result.error.issues[0].message).toBe("Tasa inválida para IVA_GENERAL: debe ser 16%");
      }
    });

    it("rate 16.5 con el IVA canónico (160.00): SOLO el issue de la tasa (el monto se contrasta con 16 %, no con 16,5 %)", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.5", amount: "160.00" }]),
      );
      expectRateRejected(result);
      expect(ivaIssues(result)).toEqual([]);
    });

    it("IVA_REDUCIDO con la rate del GENERAL (16) y monto 160.00: además de la tasa, el monto se contrasta con el 8 % canónico (80.00)", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "IVA_REDUCIDO", base: "1000.00", rate: "16", amount: "160.00" }]),
      );
      expectRateRejected(result);
      expectIvaRejected(result, [0], { received: "160.00", expected: "80.00" }); // esperado: 1000.00 x 8 %
    });

    it("EXENTO con rate 0.5 (plana, no canónica) y monto 5.00: además de la tasa, el monto se contrasta con 0 % (0.00)", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([{ taxType: "EXENTO", base: "1000.00", rate: "0.5", amount: "5.00" }]),
      );
      expectRateRejected(result);
      expectIvaRejected(result, [0], { received: "5.00", expected: "0.00" }); // esperado: 1000.00 x 0 %
    });

    it("una línea buena y otra con rate no canónica → el issue de la tasa y el del monto apuntan al índice 1", () => {
      const result = CreateInvoiceSchema.safeParse(
        build([general("1000.00", "160.00"), { taxType: "IVA_REDUCIDO", base: "500.00", rate: "10", amount: "50.00" }]),
      );
      expectRateRejected(result, [1]);
      expectIvaRejected(result, [1], { received: "50.00", expected: "40.00" }); // 500.00 x 8 %
    });
  });

  // ── Misma regla vía la fábrica por país (así la usan las actions) ────────────────────────────────
  describe("vía getInvoiceSchemas(getFiscalConfig('VEN')) — como las actions", () => {
    const schemas = getInvoiceSchemas(getFiscalConfig("VEN"));
    const bad = (doc: (lines: object[]) => object) =>
      doc([{ taxType: "IVA_GENERAL", base: "1000.00", rate: "1.6e1", amount: "160.00" }]);

    it("create: rate '1.6e1' se rechaza en ['taxLines', 0, 'rate']", () => {
      expectRateRejected(schemas.create.safeParse(bad((l) => saleDoc("FACTURA", l))));
    });
    it("creditDebitNote: rate '0x10' se rechaza en ['taxLines', 0, 'rate']", () => {
      expectRateRejected(
        schemas.creditDebitNote.safeParse(
          asNote(saleDoc("NOTA_CREDITO", [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "0x10", amount: "160.00" }])),
        ),
      );
    });
    it("createWithLines: rate '16.0000000000000' se rechaza en ['taxLines', 0, 'rate']", () => {
      expectRateRejected(
        schemas.createWithLines.safeParse(
          saleDoc("FACTURA", [{ taxType: "IVA_GENERAL", base: "1000.00", rate: "16.0000000000000", amount: "160.00" }]),
        ),
      );
    });
    it("create: COMPRA con rate '1.6e1' también se rechaza", () => {
      expectRateRejected(schemas.create.safeParse(bad((l) => purchaseDoc("FACTURA", l))));
    });
  });
});

// ─── Hueco B — la tolerancia depende de la moneda del documento ───────────────────────────────────
// Base 1000.00 IVA_GENERAL → esperado 160.00. El resto de la moneda extranjera no exige campos adicionales al schema
// (`exchangeRateId` es opcional: lo resuelve la action), así que el ÚNICO motivo de rechazo posible es el IVA.
describe("ADR-049 hueco B — tolerancia por moneda: currency !== VES usa SIEMPRE 0.01", () => {
  const FOREIGN = ["USD", "EUR"];
  const inCurrency = (doc: object, currency: string) => ({ ...doc, currency });

  // ── B.1 COMPRA ──────────────────────────────────────────────────────────────────────────────────
  describe("COMPRA en VES — el IVA impreso manda, tolerancia Bs. 1.00 (guarda, pasa hoy)", () => {
    it.each([
      { name: "sin currency (default VES)", extra: {} },
      { name: "currency VES explícita", extra: { currency: "VES" } },
    ])("$name: acepta IVA impreso 160.50 (dif 0.50 <= 1.00)", ({ extra }) => {
      expectAccepted(CreateInvoiceSchema.safeParse({ ...purchaseDoc("FACTURA", [general("1000.00", "160.50")]), ...extra }));
    });

    it("VES: el borde 161.00 (dif 1.00) se acepta y 161.01 se rechaza", () => {
      const at = (amount: string) => CreateInvoiceSchema.safeParse(inCurrency(purchaseDoc("FACTURA", [general("1000.00", amount)]), "VES"));
      expectAccepted(at("161.00"));
      expectIvaRejected(at("161.01"), [0], { received: "161.01", expected: "160.00" });
    });
  });

  describe.each(FOREIGN)("COMPRA en %s — tolerancia estricta 0.01 (la unidad mínima de la moneda)", (currency) => {
    describe.each(["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO", "PLANILLA_IMPORTACION", "OTRO"])("%s", (docType) => {
      const at = (amount: string) => CreateInvoiceSchema.safeParse(inCurrency(purchaseDoc(docType, [general("1000.00", amount)]), currency));

      it.each(["160.00", "160.01", "159.99"])("acepta IVA impreso %s (exacto o borde de 0.01)", (amount) => {
        expectAccepted(at(amount));
      });

      it.each([
        { amount: "160.02", why: "dif 0.02 por encima del borde" },
        { amount: "159.98", why: "dif 0.02 por debajo del borde" },
        { amount: "160.50", why: "dif 0.50: en VES se aceptaría, en moneda extranjera no" },
        { amount: "161.00", why: "dif 1.00: el borde de VES NO aplica" },
      ])("rechaza IVA impreso $amount ($why)", ({ amount }) => {
        expectIvaRejected(at(amount), [0], { received: amount, expected: "160.00" });
      });
    });

    it("vía el schema de notas (NOTA_CREDITO de proveedor): 160.01 se acepta y 160.50 se rechaza", () => {
      const at = (amount: string) =>
        CreateCreditDebitNoteSchema.safeParse(asNote(inCurrency(purchaseDoc("NOTA_CREDITO", [general("1000.00", amount)]), currency)));
      expectAccepted(at("160.01"));
      expectIvaRejected(at("160.50"), [0], { received: "160.50", expected: "160.00" });
    });
  });

  // ── B.2 VENTA REPORTE_Z / RESUMEN_VENTAS / OTRO / PLANILLA_IMPORTACION ──────────────────────────
  describe.each(["REPORTE_Z", "RESUMEN_VENTAS", "OTRO", "PLANILLA_IMPORTACION"])("VENTA %s", (docType) => {
    it.each(["160.50", "161.00"])("en VES acepta IVA %s (impresora fiscal, tolerancia 1.00; guarda, pasa hoy)", (amount) => {
      expectAccepted(CreateInvoiceSchema.safeParse(inCurrency(saleDoc(docType, [general("1000.00", amount)]), "VES")));
    });

    describe.each(FOREIGN)("en %s — tolerancia 0.01", (currency) => {
      const at = (amount: string) => CreateInvoiceSchema.safeParse(inCurrency(saleDoc(docType, [general("1000.00", amount)]), currency));

      it.each(["160.00", "160.01", "159.99"])("acepta IVA %s", (amount) => {
        expectAccepted(at(amount));
      });
      it.each([
        { amount: "160.50", why: "dif 0.50" },
        { amount: "159.50", why: "dif 0.50 por debajo" },
        { amount: "161.00", why: "dif 1.00: el borde de VES NO aplica" },
        { amount: "160.02", why: "dif 0.02" },
      ])("rechaza IVA $amount ($why)", ({ amount }) => {
        expectIvaRejected(at(amount), [0], { received: amount, expected: "160.00" });
      });
    });
  });

  // ── B.3 VENTA FACTURA / NC / ND en moneda extranjera: ya era estricta (guarda, pasa hoy) ─────────
  describe.each(["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO"])("VENTA %s en moneda extranjera (guarda)", (docType) => {
    it.each(FOREIGN)("%s: acepta 160.01 y rechaza 160.02", (currency) => {
      const at = (amount: string) => CreateInvoiceSchema.safeParse(inCurrency(saleDoc(docType, [general("1000.00", amount)]), currency));
      expectAccepted(at("160.01"));
      expectIvaRejected(at("160.02"), [0], { received: "160.02", expected: "160.00" });
    });
  });

  // ── B.4 El mensaje nombra la moneda del documento ───────────────────────────────────────────────
  describe("mensaje del issue: la unidad es la moneda del documento, no siempre 'Bs.'", () => {
    /** Devuelve el mensaje del ÚNICO issue de IVA; falla si el schema no lo rechaza. */
    function messageOf(doc: object): string {
      const result = CreateInvoiceSchema.safeParse(doc);
      expectIvaRejected(result);
      return ivaIssues(result)[0].message;
    }

    it.each([
      { name: "currency VES explícita", extra: { currency: "VES" } },
      { name: "sin currency (default VES)", extra: {} },
    ])("COMPRA $name: dice 'Bs.' con recibido, esperado y tolerancia 1.00, y no nombra otra moneda", ({ extra }) => {
      const message = messageOf({ ...purchaseDoc("FACTURA", [general("1000.00", "12.34")]), ...extra });
      expect(message).toContain("Bs.");
      expect(message).not.toContain("USD");
      expect(message).not.toContain("EUR");
      expect(message).toMatch(money("12.34"));
      expect(message).toMatch(money("160.00"));
      expect(message).toMatch(money("1.00"));
    });

    it.each(FOREIGN)("COMPRA en %s: nombra la moneda, NO dice 'Bs.' y anuncia la tolerancia 0.01", (currency) => {
      const message = messageOf(inCurrency(purchaseDoc("FACTURA", [general("1000.00", "12.34")]), currency));
      expect(message).toContain(currency);
      expect(message).not.toContain("Bs.");
      expect(message).toMatch(money("12.34")); // recibido
      expect(message).toMatch(money("160.00")); // esperado: 1000.00 x 16 %
      expect(message).toMatch(money("0.01")); // tolerancia de la moneda extranjera
      expect(message).not.toMatch(money("1.00")); // no anuncia la tolerancia de VES
    });

    it.each(FOREIGN)("VENTA REPORTE_Z en %s: nombra la moneda, NO dice 'Bs.' y la tolerancia es 0.01", (currency) => {
      const message = messageOf(inCurrency(saleDoc("REPORTE_Z", [general("1000.00", "12.34")]), currency));
      expect(message).toContain(currency);
      expect(message).not.toContain("Bs.");
      expect(message).toMatch(money("0.01"));
      expect(message).not.toMatch(money("1.00"));
    });

    it.each(FOREIGN)("VENTA FACTURA en %s (ya estricta): nombra la moneda y NO dice 'Bs.'", (currency) => {
      const message = messageOf(inCurrency(saleDoc("FACTURA", [general("1000.00", "12.34")]), currency));
      expect(message).toContain(currency);
      expect(message).not.toContain("Bs.");
      expect(message).toMatch(money("0.01"));
    });

    it("VENTA REPORTE_Z en VES: sigue diciendo 'Bs.' con tolerancia 1.00 (guarda)", () => {
      const message = messageOf(inCurrency(saleDoc("REPORTE_Z", [general("1000.00", "12.34")]), "VES"));
      expect(message).toContain("Bs.");
      expect(message).toMatch(money("1.00"));
    });
  });

  // ── Misma regla vía la fábrica por país (así la usan las actions) ────────────────────────────────
  describe("vía getInvoiceSchemas(getFiscalConfig('VEN')) — como las actions", () => {
    const schemas = getInvoiceSchemas(getFiscalConfig("VEN"));

    it("create: COMPRA en VES con IVA impreso 160.50 se acepta (guarda)", () => {
      expectAccepted(schemas.create.safeParse(inCurrency(purchaseDoc("FACTURA", [general("1000.00", "160.50")]), "VES")));
    });
    it.each(FOREIGN)("create: COMPRA en %s con IVA impreso 160.50 se rechaza", (currency) => {
      expectIvaRejected(
        schemas.create.safeParse(inCurrency(purchaseDoc("FACTURA", [general("1000.00", "160.50")]), currency)),
        [0],
        { received: "160.50", expected: "160.00" },
      );
    });
    it.each(FOREIGN)("create: VENTA REPORTE_Z en %s con dif 0.50 se rechaza", (currency) => {
      expectIvaRejected(
        schemas.create.safeParse(inCurrency(saleDoc("REPORTE_Z", [general("1000.00", "160.50")]), currency)),
        [0],
        { received: "160.50", expected: "160.00" },
      );
    });
    it.each(FOREIGN)("creditDebitNote: COMPRA NOTA_DEBITO en %s con IVA impreso 160.50 se rechaza y con 160.01 se acepta", (currency) => {
      const at = (amount: string) =>
        schemas.creditDebitNote.safeParse(asNote(inCurrency(purchaseDoc("NOTA_DEBITO", [general("1000.00", amount)]), currency)));
      expectIvaRejected(at("160.50"), [0], { received: "160.50", expected: "160.00" });
      expectAccepted(at("160.01"));
    });
    it.each(FOREIGN)("createWithLines: COMPRA en %s con IVA impreso 160.50 se rechaza (hereda la regla)", (currency) => {
      expectIvaRejected(
        schemas.createWithLines.safeParse(inCurrency(purchaseDoc("FACTURA", [general("1000.00", "160.50")]), currency)),
        [0],
        { received: "160.50", expected: "160.00" },
      );
    });
  });
});
