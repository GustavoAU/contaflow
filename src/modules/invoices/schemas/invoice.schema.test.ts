// src/modules/invoices/schemas/invoice.schema.test.ts
import { describe, it, expect } from "vitest";
import { CreateInvoiceSchema } from "./invoice.schema";

// ─── Datos base para los tests ────────────────────────────────────────────────

const BASE_INVOICE = {
  companyId: "company-1",
  type: "PURCHASE" as const,
  invoiceNumber: "00000001",
  date: new Date("2026-01-01"),
  counterpartName: "Proveedor S.A.",
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

    it("acepta V-87654321 (venezolano sin dígito verificador)", () => {
      const result = CreateInvoiceSchema.safeParse({
        ...BASE_INVOICE,
        counterpartRif: "V-87654321",
      });
      expect(result.success).toBe(true);
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
