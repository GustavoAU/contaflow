// src/modules/vendors/__tests__/partner.schemas.test.ts
// TDD SPEC (RED) — ADR-054: schemas Zod para Partner (socio/accionista).
// NO existe todavía `src/modules/vendors/schemas/partner.schemas.ts` — se espera que este
// archivo falle con "Cannot find module" hasta que se implemente.
//
// Nota de diseño (ver informe del test-agent): la orden de trabajo especificó "name: min 2
// chars" para Partner, que difiere deliberadamente de CreateVendorSchema/CreateCustomerSchema
// (min 1 char). Se respeta el spec tal como fue dado; queda señalado como punto a confirmar.

import { describe, it, expect } from "vitest";
import { CreatePartnerSchema, UpdatePartnerSchema } from "../schemas/partner.schemas";

describe("CreatePartnerSchema — name", () => {
  it("rechaza nombre de 1 carácter", () => {
    expect(CreatePartnerSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  it("acepta nombre de 2+ caracteres sin rif", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana" }).success).toBe(true);
  });

  it("rechaza nombre vacío", () => {
    expect(CreatePartnerSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rechaza ausencia de name", () => {
    expect(CreatePartnerSchema.safeParse({}).success).toBe(false);
  });

  it('rechaza nombre que tras trim queda en 1 carácter (" A ")', () => {
    expect(CreatePartnerSchema.safeParse({ name: " A " }).success).toBe(false);
  });
});

describe("CreatePartnerSchema — rif (reusa VEN_RIF_REGEX de Vendor/Customer, ADR-054)", () => {
  it("acepta sin rif", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez" }).success).toBe(true);
  });

  it("acepta rif J-12345678-9 (con dígito verificador)", () => {
    const r = CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "J-12345678-9" });
    expect(r.success).toBe(true);
  });

  it("acepta rif V-12345678-0 (persona natural)", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "V-12345678-0" }).success).toBe(
      true
    );
  });

  it("acepta rif C-12345678-9 (comunal, LL-001 regresión)", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "C-12345678-9" }).success).toBe(
      true
    );
  });

  it("rechaza rif sin dígito verificador (V-12345678)", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "V-12345678" }).success).toBe(
      false
    );
  });

  it("rechaza rif sin guión (J12345678)", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "J12345678" }).success).toBe(
      false
    );
  });

  it("rechaza rif con prefijo no soportado (X-12345678-9)", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "X-12345678-9" }).success).toBe(
      false
    );
  });

  it('convierte rif "" en null (limpia la columna, evita P2002 en @@unique([companyId, rif]))', () => {
    const r = CreatePartnerSchema.safeParse({ name: "Ana Pérez", rif: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.rif).toBeNull();
  });
});

describe("CreatePartnerSchema — notes", () => {
  it("acepta sin notes", () => {
    expect(CreatePartnerSchema.safeParse({ name: "Ana Pérez" }).success).toBe(true);
  });

  it("acepta notes con texto", () => {
    const r = CreatePartnerSchema.safeParse({
      name: "Ana Pérez",
      notes: "Socio fundador, 30% del capital",
    });
    expect(r.success).toBe(true);
  });

  it('convierte notes "" en null', () => {
    const r = CreatePartnerSchema.safeParse({ name: "Ana Pérez", notes: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBeNull();
  });
});

describe("UpdatePartnerSchema — todos los campos opcionales", () => {
  it("acepta objeto vacío (ningún campo cambia)", () => {
    expect(UpdatePartnerSchema.safeParse({}).success).toBe(true);
  });

  it("acepta solo name", () => {
    expect(UpdatePartnerSchema.safeParse({ name: "Nuevo Nombre" }).success).toBe(true);
  });

  it("rechaza name de 1 carácter si se envía (misma regla que create)", () => {
    expect(UpdatePartnerSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  it("acepta solo rif", () => {
    expect(UpdatePartnerSchema.safeParse({ rif: "J-12345678-9" }).success).toBe(true);
  });

  it("rechaza rif inválido si se envía", () => {
    expect(UpdatePartnerSchema.safeParse({ rif: "INVALIDO" }).success).toBe(false);
  });

  it("acepta solo notes", () => {
    expect(UpdatePartnerSchema.safeParse({ notes: "Actualización" }).success).toBe(true);
  });
});
