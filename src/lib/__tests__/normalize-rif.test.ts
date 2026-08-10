// src/lib/__tests__/normalize-rif.test.ts
//
// MEDIUM-2 (auditoría de seguridad MP-1). El `@unique` de Postgres compara strings
// crudos: "J-12345678-9" y "j-123456789" convivían como dos identidades fiscales
// distintas. En ManagedClient cada variante además consumía un cupo del tier que
// el despacho paga.

import { describe, it, expect } from "vitest";
import { normalizeRif, normalizeRifOrNull, VEN_RIF_REGEX } from "../tax-config";

describe("normalizeRif — forma canónica", () => {
  it("colapsa TODAS las variantes de la misma identidad fiscal a un solo string", () => {
    const variantes = [
      "J-12345678-9",
      "j-12345678-9",
      "J123456789",
      "j123456789",
      "J-123456789",
      "  J-12345678-9  ",
      "J 12345678 9",
      "j.12345678.9",
    ];
    const canonicas = new Set(variantes.map(normalizeRif));
    expect(
      canonicas,
      `Se esperaba UNA sola forma canónica, salieron: ${[...canonicas].join(" | ")}`,
    ).toEqual(new Set(["J-12345678-9"]));
  });

  it("acepta todas las letras válidas de RIF", () => {
    for (const letra of ["J", "V", "E", "G", "C", "P"]) {
      expect(normalizeRif(`${letra.toLowerCase()}123456789`)).toBe(`${letra}-12345678-9`);
    }
  });

  it("respeta el RIF legacy sin dígito verificador, sin inventarle uno", () => {
    // Existen empresas creadas con la regex laxa anterior (ver assertRifEditable).
    expect(normalizeRif("j-12345678")).toBe("J-12345678");
  });

  it("NO unifica el legacy con el completo — son identificadores distintos", () => {
    // Decidir que "J-12345678" ES "J-12345678-9" exigiría inventar el verificador.
    expect(normalizeRif("J-12345678")).not.toBe(normalizeRif("J-12345678-9"));
  });

  it("es idempotente: normalizar lo ya normalizado no lo cambia", () => {
    const once = normalizeRif("j 123456789");
    expect(normalizeRif(once)).toBe(once);
  });

  it("produce un valor que pasa la regex canónica", () => {
    expect(VEN_RIF_REGEX.test(normalizeRif("j123456789"))).toBe(true);
  });

  it("no inventa estructura si el valor no tiene forma de RIF", () => {
    // Validar el formato es tarea de taxIdRegex, no de la normalización.
    expect(normalizeRif("X-99")).toBe("X-99");
    expect(normalizeRif("  basura  ")).toBe("BASURA");
    expect(normalizeRif("")).toBe("");
  });
});

describe("normalizeRifOrNull — tolerante a ausencia", () => {
  it("mapea null/undefined/vacío a null", () => {
    expect(normalizeRifOrNull(null)).toBeNull();
    expect(normalizeRifOrNull(undefined)).toBeNull();
    expect(normalizeRifOrNull("")).toBeNull();
    expect(normalizeRifOrNull("   ")).toBeNull();
  });

  it("normaliza igual que normalizeRif cuando hay valor", () => {
    expect(normalizeRifOrNull("j-123456789")).toBe("J-12345678-9");
  });
});
