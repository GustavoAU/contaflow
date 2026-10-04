// src/modules/import/schemas/import.schema.test.ts
// GUARDA de compatibilidad para la plantilla simple actual (4 columnas: codigo/nombre/
// tipo/descripcion) tras agregar `isPostable` al schema (feature cuentas de título).
// Los demás casos (inferencia de tipo por dígito, alias G/M, alias nombre/descripcion)
// son de INTEGRACIÓN — viven en ImportService.test.ts porque dependen del mapeo de
// encabezados que hace ImportService.parseAccountsExcel, no del schema en sí.
//
// RED hoy: `isPostable` no existe en ImportAccountRowSchema — `parsed.isPostable` es
// `undefined`, no `true`. Implementar agregando `isPostable: z.boolean().default(true)`
// al schema (ver propuesta en el informe del test-agent).
import { describe, it, expect } from "vitest";
import {
  ImportAccountRowSchema,
  ImportErrorReasonSchema,
  type ImportAccountRow,
} from "./import.schema";

describe("ImportAccountRowSchema — topes de longitud (L-2 auditoría SPEC-008)", () => {
  const base = { codigo: "1.1.01.01.001", nombre: "Caja", tipo: "ASSET" as const };

  it("acepta los topes exactos (código 20, nombre 100, descripción 255)", () => {
    expect(
      ImportAccountRowSchema.safeParse({
        codigo: "1".repeat(20),
        nombre: "N".repeat(100),
        tipo: "ASSET",
        descripcion: "d".repeat(255),
      }).success
    ).toBe(true);
  });

  it("rechaza código de 21, nombre de 101 y descripción de 256 caracteres", () => {
    expect(ImportAccountRowSchema.safeParse({ ...base, codigo: "1".repeat(21) }).success).toBe(
      false
    );
    expect(ImportAccountRowSchema.safeParse({ ...base, nombre: "N".repeat(101) }).success).toBe(
      false
    );
    expect(
      ImportAccountRowSchema.safeParse({ ...base, descripcion: "d".repeat(256) }).success
    ).toBe(false);
  });

  it("recorta espacios en código y nombre", () => {
    const parsed = ImportAccountRowSchema.parse({
      ...base,
      codigo: "  1.1.01  ",
      nombre: "  Caja  ",
    });
    expect(parsed.codigo).toBe("1.1.01");
    expect(parsed.nombre).toBe("Caja");
  });
});

describe("ImportAccountRowSchema — compatibilidad con la plantilla actual (4 columnas)", () => {
  it("fila con tipo explícito (ASSET) y SIN columna G/M sigue aceptándose — isPostable default true", () => {
    const parsed = ImportAccountRowSchema.parse({
      codigo: "1105",
      nombre: "Caja General",
      tipo: "ASSET",
      descripcion: "Efectivo en caja",
    });

    // Cast defensivo: funciona tanto hoy (campo ausente → undefined) como tras
    // agregar `isPostable` al schema real — no requiere editar este test.
    const withPostable = parsed as ImportAccountRow & { isPostable?: boolean };
    expect(withPostable.isPostable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Feature: cuenta "formula presupuesto" (columna "Pre." del ERP real, feedback
// tester Alpha 2026-09-26) — Account.isBudgetable, sin consecuencia fiscal (solo
// filtrado/UX para BudgetLine). Ver ADR-053 para el precedente isPostable/G-M.
//
// RED hoy: `isBudgetable` no existe en ImportAccountRowSchema — `parsed.isBudgetable`
// es `undefined`, no `false`. Implementar agregando
// `isBudgetable: z.boolean().default(false)` al schema.
// ---------------------------------------------------------------------------
describe("ImportAccountRowSchema — isBudgetable (columna 'Pre.')", () => {
  it("fila con tipo explícito (ASSET) y SIN columna 'pre.' → isBudgetable default false", () => {
    const parsed = ImportAccountRowSchema.parse({
      codigo: "1105",
      nombre: "Caja General",
      tipo: "ASSET",
    });

    // Cast defensivo: mismo patrón que isPostable arriba — funciona hoy (undefined)
    // y tras implementar el default (false), sin tener que editar este test.
    const withBudgetable = parsed as ImportAccountRow & { isBudgetable?: boolean };
    expect(withBudgetable.isBudgetable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Feature: tercero obligatorio en cuenta "pote" (columna "Ter." del ERP real,
// decisión del dueño 2026-09-26) — Account.requiresThirdParty, exigido por
// src/lib/prisma-tercero-required-gate.ts (ADR-054). Ver ADR-053 para el
// precedente isPostable/G-M e isBudgetable/Pre.
//
// RED hoy: `requiresThirdParty` no existe en ImportAccountRowSchema —
// `parsed.requiresThirdParty` es `undefined`, no `false`. Implementar agregando
// `requiresThirdParty: z.boolean().default(false)` al schema.
// ---------------------------------------------------------------------------
describe("ImportAccountRowSchema — requiresThirdParty (columna 'Ter.')", () => {
  it("fila con tipo explícito (ASSET) y SIN columna 'ter.' → requiresThirdParty default false", () => {
    const parsed = ImportAccountRowSchema.parse({
      codigo: "1105",
      nombre: "Caja General",
      tipo: "ASSET",
    });

    // Cast defensivo: mismo patrón que isPostable/isBudgetable arriba — funciona
    // hoy (undefined) y tras implementar el default (false), sin tener que editar
    // este test.
    const withThirdParty = parsed as ImportAccountRow & { requiresThirdParty?: boolean };
    expect(withThirdParty.requiresThirdParty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SPEC-008 RN-11: una cuenta de movimiento sin su título padre es un error de FILA
// (`reason: "missing_parent"`) que no aborta el lote. El enum de razones debe aceptarlo.
// ---------------------------------------------------------------------------
describe("ImportErrorReasonSchema — razones de error de fila (SPEC-008)", () => {
  it.each(["duplicate_code", "missing_parent", "unknown"])("acepta la razón %s", (reason) => {
    expect(ImportErrorReasonSchema.safeParse(reason).success).toBe(true);
  });

  it("el enum contiene EXACTAMENTE duplicate_code, missing_parent y unknown", () => {
    expect([...ImportErrorReasonSchema.options].sort()).toEqual([
      "duplicate_code",
      "missing_parent",
      "unknown",
    ]);
  });

  it.each(["name_conflict", "bad_format", "not_a_title", "", "MISSING_PARENT"])(
    "rechaza la razón inventada %j",
    (reason) => {
      expect(ImportErrorReasonSchema.safeParse(reason).success).toBe(false);
    }
  );
});
