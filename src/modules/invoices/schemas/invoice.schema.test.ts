// src/modules/invoices/schemas/invoice.schema.test.ts
import { describe, it, expect } from "vitest";
import { CreateInvoiceSchema } from "./invoice.schema";

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
