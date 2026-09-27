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
import { ImportAccountRowSchema, type ImportAccountRow } from "./import.schema";

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
