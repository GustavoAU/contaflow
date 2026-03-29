// src/modules/retentions/schemas/retention.schema.test.ts
import { describe, it, expect } from "vitest";
import { CreateRetentionSchema } from "./retention.schema";

// ─── Datos base para los tests ────────────────────────────────────────────────

const BASE_RETENTION = {
  companyId: "company-1",
  providerName: "Proveedor S.A.",
  invoiceNumber: "00000001",
  invoiceDate: new Date("2026-01-01"),
  invoiceAmount: "1160",
  taxBase: "1000",
  ivaAmount: "160",
  ivaRetentionPct: 75,
  type: "IVA" as const,
  createdBy: "user-1",
};

// ─── Tests RIF — Item 18.6 ────────────────────────────────────────────────────

describe("CreateRetentionSchema — validación RIF (18.6)", () => {
  describe("RIFs válidos", () => {
    it("acepta J-12345678-9 (jurídico con dígito verificador)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "J-12345678-9",
      });
      expect(result.success).toBe(true);
    });

    it("acepta V-87654321 (venezolano sin dígito verificador)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "V-87654321",
      });
      expect(result.success).toBe(true);
    });

    it("acepta j-12345678-9 (lowercase — case insensitive)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "j-12345678-9",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("RIFs inválidos", () => {
    it("rechaza '12345678' (sin prefijo)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "12345678",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });

    it("rechaza 'J-1234567' (solo 7 dígitos — requiere 8)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "J-1234567",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });

    it("rechaza 'X-12345678-9' (prefijo no permitido)", () => {
      const result = CreateRetentionSchema.safeParse({
        ...BASE_RETENTION,
        providerRif: "X-12345678-9",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("RIF inválido. Formato: J-12345678-9");
      }
    });
  });
});
