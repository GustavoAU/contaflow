// src/modules/invoices/__tests__/invoice-schema-factory.test.ts
//
// MP-5a (ADR-042 D-1) — el contrato de las factories.
//
// Lo que se prueba NO es "el schema valida bien" (eso ya lo cubren los tests del
// módulo), sino las tres promesas de las que depende toda la fase:
//
//   1. Para VEN, el comportamiento es IDÉNTICO al de antes → cero regresión.
//   2. La estructura es invariante por país → `z.infer` sirve para cualquiera y
//      ni componentes ni tests existentes cambian.
//   3. La memoización devuelve el MISMO objeto por país → no se reconstruyen
//      schemas en cada request.

import { describe, it, expect } from "vitest";
import { getFiscalConfig, VEN_FISCAL_CONFIG } from "@/lib/countries";
import type { FiscalConfig } from "@/lib/countries/types";
import {
  CreateInvoiceSchema,
  TaxLineSchema,
  getInvoiceSchemas,
} from "../schemas/invoice.schema";
import { getQuotationSchemas } from "@/modules/orders/schemas/quotation.schema";

/** País sintético para probar que lo que varía son los VALORES, no la estructura. */
const FAKE_COUNTRY: FiscalConfig = {
  ...VEN_FISCAL_CONFIG,
  countryCode: "TEST" as FiscalConfig["countryCode"],
  countryName: "Testlandia",
  taxIdLabel: "NIT",
  taxIdRegex: /^\d{9}-\d$/,
  taxIdPlaceholder: "123456789-0",
  controlNumberRegex: undefined,
  controlNumberPlaceholder: undefined,
  taxLineRates: {
    IVA_GENERAL: { rate: "0.19", percent: "19", label: "IVA 19%" },
    EXENTO: { rate: "0", percent: "0", label: "Exento" },
  },
  itemTaxRatePercents: ["0", "19"],
};

const validInvoice = (over: Record<string, unknown> = {}) => ({
  companyId: "company-1",
  type: "SALE",
  invoiceNumber: "FAC-001",
  date: "2026-08-10",
  counterpartName: "Cliente C.A.",
  counterpartRif: "J-12345678-9",
  taxLines: [],
  ...over,
});

describe("MP-5a — memoización por país", () => {
  it("devuelve el MISMO objeto para el mismo país", () => {
    expect(getInvoiceSchemas(VEN_FISCAL_CONFIG)).toBe(getInvoiceSchemas(getFiscalConfig("VEN")));
  });

  it("el ancla VEN exportada ES el schema de la factory, no una copia", () => {
    // Si divergieran, la UI validaría distinto que las actions
    expect(CreateInvoiceSchema).toBe(getInvoiceSchemas(VEN_FISCAL_CONFIG).create);
    expect(TaxLineSchema).toBe(getInvoiceSchemas(VEN_FISCAL_CONFIG).taxLine);
  });
});

describe("MP-5a — VEN sin regresión", () => {
  it("acepta un RIF venezolano válido", () => {
    expect(CreateInvoiceSchema.safeParse(validInvoice()).success).toBe(true);
  });

  it("rechaza un RIF con el mensaje de siempre", () => {
    const r = CreateInvoiceSchema.safeParse(validInvoice({ counterpartRif: "J-123" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
  });

  it("exige Nº Control en COMPRAS y valida su formato", () => {
    const sinControl = CreateInvoiceSchema.safeParse(validInvoice({ type: "PURCHASE" }));
    expect(sinControl.success).toBe(false);

    const malo = CreateInvoiceSchema.safeParse(
      validInvoice({ type: "PURCHASE", controlNumber: "1-23" }),
    );
    expect(malo.success).toBe(false);
    if (!malo.success) expect(malo.error.issues[0].message).toContain("00-00000001");

    const bueno = CreateInvoiceSchema.safeParse(
      validInvoice({ type: "PURCHASE", controlNumber: "00-12345678" }),
    );
    expect(bueno.success).toBe(true);
  });

  it("mantiene las alícuotas canónicas venezolanas (ADR-006 D-3)", () => {
    const ok = TaxLineSchema.safeParse({ taxType: "IVA_GENERAL", base: "100", rate: "16", amount: "16" });
    expect(ok.success).toBe(true);

    const mala = TaxLineSchema.safeParse({ taxType: "IVA_GENERAL", base: "100", rate: "19", amount: "19" });
    expect(mala.success).toBe(false);
    if (!mala.success) expect(mala.error.issues[0].message).toContain("debe ser 16%");
  });

  it("cotizaciones: el 15 de lujo NO es alícuota de ítem suelto", () => {
    const { item } = getQuotationSchemas(VEN_FISCAL_CONFIG);
    const base = { description: "Ítem", unit: "und", quantity: "1", unitPrice: "100" };

    for (const rate of ["0", "8", "16"]) {
      expect(item.safeParse({ ...base, taxRate: rate }).success, rate).toBe(true);
    }
    // El IVA Adicional es un recargo sobre el general, nunca una tasa por sí sola
    expect(item.safeParse({ ...base, taxRate: "15" }).success).toBe(false);
  });
});

describe("MP-5a — lo que varía son los VALORES, no la ESTRUCTURA", () => {
  const fake = getInvoiceSchemas(FAKE_COUNTRY);

  it("otro país trae su propio formato de ID tributario y su mensaje", () => {
    expect(fake.create.safeParse(validInvoice({ counterpartRif: "123456789-0" })).success).toBe(true);

    const r = fake.create.safeParse(validInvoice({ counterpartRif: "J-12345678-9" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("NIT inválido. Formato: 123456789-0");
  });

  it("un país SIN Nº de control no lo exige en compras", () => {
    // El RIF también va en formato del país sintético: si no, fallaría por eso
    // y el test pasaría a medir otra cosa.
    const r = fake.create.safeParse(
      validInvoice({ type: "PURCHASE", counterpartRif: "123456789-0" }),
    );
    expect(r.success).toBe(true);
  });

  it("las alícuotas canónicas salen de la config del país", () => {
    const ok = fake.taxLine.safeParse({ taxType: "IVA_GENERAL", base: "100", rate: "19", amount: "19" });
    expect(ok.success).toBe(true);

    const mala = fake.taxLine.safeParse({ taxType: "IVA_GENERAL", base: "100", rate: "16", amount: "16" });
    expect(mala.success).toBe(false);
  });

  it("MISMA forma: las claves del objeto no dependen del país", () => {
    const ven = CreateInvoiceSchema.safeParse(validInvoice());
    const otro = fake.create.safeParse(validInvoice({ counterpartRif: "123456789-0" }));
    expect(ven.success && otro.success).toBe(true);
    if (!ven.success || !otro.success) return;
    // Esto es lo que sostiene que `z.infer` sea invariante por país y que ni un
    // componente ni un test existente tengan que cambiar.
    expect(Object.keys(otro.data).sort()).toEqual(Object.keys(ven.data).sort());
  });
});
