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
