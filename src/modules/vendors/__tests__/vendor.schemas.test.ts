// src/modules/vendors/__tests__/vendor.schemas.test.ts
import { describe, it, expect } from "vitest";
import { CreateVendorSchema, CreateCustomerSchema } from "../schemas/vendor.schemas";

describe("CreateVendorSchema — RIF validation (HIGH-3)", () => {
  it("acepta sin RIF", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });
  it("acepta RIF J-12345678-9", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", rif: "J-12345678-9" }).success).toBe(true);
  });
  it("rechaza RIF V-12345678 (sin dígito verificador)", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", rif: "V-12345678" }).success).toBe(false);
  });
  it("acepta RIF V-12345678-0 (con dígito verificador)", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", rif: "V-12345678-0" }).success).toBe(true);
  });
  it("rechaza RIF inválido", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", rif: "INVALID" }).success).toBe(false);
  });
  it("rechaza RIF sin guión", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", rif: "J12345678" }).success).toBe(false);
  });
});

describe("CreateVendorSchema — text fields (MEDIUM-1 trim)", () => {
  it("rechaza nombre vacío", () => {
    expect(CreateVendorSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("rechaza nombre mayor a 200 chars", () => {
    expect(CreateVendorSchema.safeParse({ name: "A".repeat(201) }).success).toBe(false);
  });
  it("acepta email válido", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", email: "test@example.com" }).success).toBe(true);
  });
  it("rechaza email inválido", () => {
    expect(CreateVendorSchema.safeParse({ name: "Acme", email: "no-es-email" }).success).toBe(false);
  });
  it("convierte string vacío en undefined (email)", () => {
    const r = CreateVendorSchema.safeParse({ name: "Acme", email: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeUndefined();
  });
});

describe("CreateCustomerSchema — mismos controles", () => {
  it("acepta nombre válido sin RIF", () => {
    expect(CreateCustomerSchema.safeParse({ name: "Cliente SA" }).success).toBe(true);
  });
  it("rechaza RIF inválido", () => {
    expect(CreateCustomerSchema.safeParse({ name: "C", rif: "BAD" }).success).toBe(false);
  });
});
