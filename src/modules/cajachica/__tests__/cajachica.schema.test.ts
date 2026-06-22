import { describe, it, expect } from "vitest";
import { CreateMovementSchema } from "../schemas/cajachica.schema";

// HC-01 (ADR-037): supportingDocumentId SIEMPRE obligatorio (se eliminó el refine del
// umbral 500k). HC-10 (ADR-037): providerRif opcional, normalizado (trim+upper), validado
// contra VEN_RIF_REGEX cuando viene.

const base = {
  companyId: "comp-1",
  cajaCajaId: "caja-1",
  date: "2026-06-13",
  concept: "Café",
  expenseAccountId: "acc-exp",
  amount: "150000",
  currency: "VES" as const,
  supportingDocumentId: "FAC-001",
};

describe("CreateMovementSchema — HC-01 supportingDocumentId obligatorio", () => {
  it("acepta input válido con supportingDocumentId presente", () => {
    const r = CreateMovementSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("RECHAZA si falta supportingDocumentId", () => {
    const { supportingDocumentId: _omit, ...sinSoporte } = base;
    void _omit;
    const r = CreateMovementSchema.safeParse(sinSoporte);
    expect(r.success).toBe(false);
  });

  it("RECHAZA si supportingDocumentId está vacío", () => {
    const r = CreateMovementSchema.safeParse({ ...base, supportingDocumentId: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /soporte/i.test(i.message))).toBe(true);
    }
  });
});

describe("CreateMovementSchema — HC-10 providerRif", () => {
  it("acepta y NORMALIZA un RIF en minúsculas a mayúsculas", () => {
    const r = CreateMovementSchema.safeParse({ ...base, providerRif: "j-12345678-9" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerRif).toBe("J-12345678-9");
  });

  it("normaliza recortando espacios (trim) y a mayúsculas", () => {
    const r = CreateMovementSchema.safeParse({ ...base, providerRif: "  v-12345678-1  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerRif).toBe("V-12345678-1");
  });

  it("acepta providerRif ausente → undefined", () => {
    const r = CreateMovementSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerRif).toBeUndefined();
  });

  it("acepta providerRif vacío → undefined (gasto menudo sin proveedor formal)", () => {
    const r = CreateMovementSchema.safeParse({ ...base, providerRif: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerRif).toBeUndefined();
  });

  it("acepta providerRif de solo espacios → undefined (trim lo vacía)", () => {
    const r = CreateMovementSchema.safeParse({ ...base, providerRif: "   " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.providerRif).toBeUndefined();
  });

  it("RECHAZA providerRif con formato inválido", () => {
    const r = CreateMovementSchema.safeParse({ ...base, providerRif: "123" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /RIF/i.test(i.message))).toBe(true);
    }
  });
});
