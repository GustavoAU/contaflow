// src/modules/company/__tests__/rif-grandfathering.test.ts
// MP-1 / ADR-042 — MEDIUM-1 de la auditoría de seguridad.
//
// El endurecimiento de la regex del RIF (dígito verificador ahora OBLIGATORIO)
// podía dejar fuera de servicio a empresas creadas con la regex laxa anterior:
// el form de datos SENIAT reenvía siempre el `rif` almacenado, así que un RIF
// legacy inválido habría bloqueado la edición de dirección, teléfono, CIIU e
// isSpecialContributor — un lockout funcional del panel fiscal.
//
// Regla implementada: estricto solo cuando el RIF CAMBIA.

import { describe, it, expect } from "vitest";
import { assertRifEditable } from "../actions/company.actions";

describe("assertRifEditable — grandfathering de RIF legacy (MP-1)", () => {
  it("permite guardar sin tocar un RIF legacy inválido (sin dígito verificador)", () => {
    // Empresa creada con la regex laxa: el form lo reenvía tal cual
    expect(assertRifEditable("J-12345678", "J-12345678")).toBeNull();
  });

  it("permite guardar un RIF legacy con espacios accidentales alrededor", () => {
    expect(assertRifEditable("  J-12345678  ", "J-12345678")).toBeNull();
  });

  it("rechaza CAMBIAR el RIF a un valor con formato inválido", () => {
    expect(assertRifEditable("J-99999999", "J-12345678")).toBe(
      "RIF inválido (ej: J-12345678-9)",
    );
  });

  it("permite corregir un RIF legacy a formato canónico", () => {
    expect(assertRifEditable("J-12345678-9", "J-12345678")).toBeNull();
  });

  it("rechaza un RIF inválido nuevo en una empresa sin RIF previo", () => {
    expect(assertRifEditable("J-12345678", null)).toBe("RIF inválido (ej: J-12345678-9)");
  });

  it("acepta un RIF canónico nuevo en una empresa sin RIF previo", () => {
    expect(assertRifEditable("J-12345678-9", null)).toBeNull();
    expect(assertRifEditable("J-123456789", null)).toBeNull();
  });

  it("permite limpiar el RIF (vacío o null)", () => {
    expect(assertRifEditable("", "J-12345678")).toBeNull();
    expect(assertRifEditable(null, "J-12345678")).toBeNull();
    expect(assertRifEditable("   ", "J-12345678")).toBeNull();
  });

  it("no deja pasar basura arbitraria aprovechando el grandfathering", () => {
    expect(assertRifEditable("<script>", "J-12345678")).toBe(
      "RIF inválido (ej: J-12345678-9)",
    );
    expect(assertRifEditable("X-12345678-9", null)).toBe("RIF inválido (ej: J-12345678-9)");
  });
});
