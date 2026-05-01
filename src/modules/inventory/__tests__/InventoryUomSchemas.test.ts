import { describe, it, expect } from "vitest";
import {
  CreateUomSchema,
  UpdateUomSchema,
  SoftDeleteUomSchema,
  ListUomsSchema,
} from "../schemas/inventory-item-unit.schema";

const BASE_CREATE = {
  companyId: "company-001",
  itemId: "item-001",
  name: "Caja",
  abbreviation: "CJ",
  conversionFactor: "12",
  isBase: false,
};

describe("CreateUomSchema", () => {
  it("acepta datos válidos", () => {
    const r = CreateUomSchema.safeParse(BASE_CREATE);
    expect(r.success).toBe(true);
  });

  // CRITICAL-2: regex estricto
  it("rechaza letras en conversionFactor", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "doce" });
    expect(r.success).toBe(false);
  });

  it("rechaza conversionFactor negativo", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "-5" });
    expect(r.success).toBe(false);
  });

  it("rechaza conversionFactor = 0", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "0" });
    expect(r.success).toBe(false);
  });

  it("rechaza conversionFactor = 0.0", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "0.0" });
    expect(r.success).toBe(false);
  });

  it("acepta conversionFactor con decimales (formato válido)", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "1.5" });
    expect(r.success).toBe(true);
  });

  it("acepta conversionFactor con 10 decimales", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "1.1234567890" });
    expect(r.success).toBe(true);
  });

  it("rechaza conversionFactor con más de 10 decimales", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "1.12345678901" });
    expect(r.success).toBe(false);
  });

  it("rechaza conversionFactor más largo que 30 caracteres", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "1".repeat(31) });
    expect(r.success).toBe(false);
  });

  it("rechaza conversionFactor con símbolo monetario", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, conversionFactor: "$12" });
    expect(r.success).toBe(false);
  });

  // MEDIUM-1: .trim() en campos texto
  it("aplica trim a name", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, name: "  Caja  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Caja");
  });

  it("aplica trim a abbreviation", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, abbreviation: " CJ " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.abbreviation).toBe("CJ");
  });

  it("rechaza name vacío", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, name: "" });
    expect(r.success).toBe(false);
  });

  it("rechaza abbreviation mayor a 10 caracteres", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, abbreviation: "A".repeat(11) });
    expect(r.success).toBe(false);
  });

  it("rechaza name mayor a 60 caracteres", () => {
    const r = CreateUomSchema.safeParse({ ...BASE_CREATE, name: "A".repeat(61) });
    expect(r.success).toBe(false);
  });

  it("isBase default es false", () => {
    const { isBase, ...withoutIsBase } = BASE_CREATE;
    void isBase;
    const r = CreateUomSchema.safeParse(withoutIsBase);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.isBase).toBe(false);
  });
});

describe("UpdateUomSchema", () => {
  it("acepta solo los campos a actualizar", () => {
    const r = UpdateUomSchema.safeParse({
      unitId: "unit-001",
      companyId: "company-001",
      name: "Nueva Caja",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza conversionFactor = 0 en update", () => {
    const r = UpdateUomSchema.safeParse({
      unitId: "unit-001",
      companyId: "company-001",
      conversionFactor: "0",
    });
    expect(r.success).toBe(false);
  });

  it("aplica trim a name en update", () => {
    const r = UpdateUomSchema.safeParse({
      unitId: "unit-001",
      companyId: "company-001",
      name: "  Caja Grande  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Caja Grande");
  });

  it("acepta update sin conversionFactor (solo nombre)", () => {
    const r = UpdateUomSchema.safeParse({
      unitId: "unit-001",
      companyId: "company-001",
      name: "Otro Nombre",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.conversionFactor).toBeUndefined();
  });
});

describe("SoftDeleteUomSchema", () => {
  it("acepta datos válidos", () => {
    const r = SoftDeleteUomSchema.safeParse({ unitId: "unit-001", companyId: "company-001" });
    expect(r.success).toBe(true);
  });

  it("rechaza unitId vacío", () => {
    const r = SoftDeleteUomSchema.safeParse({ unitId: "", companyId: "company-001" });
    expect(r.success).toBe(false);
  });
});

describe("ListUomsSchema", () => {
  it("acepta datos válidos", () => {
    const r = ListUomsSchema.safeParse({ companyId: "company-001", itemId: "item-001" });
    expect(r.success).toBe(true);
  });

  it("rechaza companyId vacío", () => {
    const r = ListUomsSchema.safeParse({ companyId: "", itemId: "item-001" });
    expect(r.success).toBe(false);
  });
});
