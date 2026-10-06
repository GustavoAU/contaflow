// src/__tests__/architecture/inventory-no-single-line-entries.test.ts
//
// Guard arquitectonico (SPEC-007, RN-5 / CA-6): ningun camino de InventoryAccountingService puede
// crear un asiento de UNA sola linea. Un asiento asi tiene Σ != 0 por diseño: viola la partida
// doble y el trigger de cuadre de la SPEC-001 lo rechazaria.
//
// Hasta SPEC-007 el servicio lo permitia a proposito para la ENTRADA "standalone" (Dr Inventario
// sin contrapartida) y lo dejaba marcado con tres huellas textuales. Este test las busca; si
// reaparece cualquiera, alguien reintrodujo el asiento incompleto:
//
//   1. `expectBalanced: false`  → quantizeGLEntries sin exigir Σ = 0.
//   2. el comentario `ADR-058 B1` → la excepcion documentada del asiento de una linea.
//   3. `length >= 2) assertBalancedGLEntries` → el cuadre solo se verifica cuando hay 2+ lineas,
//      es decir, un asiento de una linea se guarda sin verificar.
//
// Se lee el TEXTO CRUDO (comentarios incluidos) a proposito: un comentario que menciona la
// excepcion es la senal de que sigue vigente. Por eso aqui NO se enmascaran comentarios, a
// diferencia de gl-quantize-coverage.test.ts, que busca llamadas reales.
//
// Environment: node

import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(process.cwd());
const SERVICE_REL = "src/modules/inventory/services/InventoryAccountingService.ts";
const SERVICE_SRC = fs.readFileSync(path.join(ROOT, SERVICE_REL), "utf-8");

// Detectores. Toleran espacios y saltos de linea (prettier puede reformatear la expresion).
const EXPECT_BALANCED_FALSE = /expectBalanced\s*:\s*false/;
const ADR_058_B1 = /ADR-058\s+B1/;
// `length >= 2` (la forma que habia) y su equivalente `length > 1`.
const ASSERT_CONDITIONED_ON_LENGTH = /length\s*(?:>=\s*2|>\s*1)\s*\)\s*assertBalancedGLEntries/;

/** Numero de linea (1-based) de la primera coincidencia, o null si no hay ninguna. */
const lineOf = (src: string, re: RegExp): number | null => {
  const m = re.exec(src);
  return m ? src.slice(0, m.index).split("\n").length : null;
};

describe("Architecture: InventoryAccountingService no crea asientos de una sola linea (SPEC-007)", () => {
  it("el detector lee el servicio real (no pasa por vacio)", () => {
    expect(SERVICE_SRC.length).toBeGreaterThan(1000);
    // El servicio verifica el cuadre de sus asientos: si esta llamada desaparece, el resto de los
    // detectores de este archivo ya no significan nada.
    expect(SERVICE_SRC).toMatch(/assertBalancedGLEntries\s*\(/);
    expect(SERVICE_SRC).toMatch(/quantizeGLEntries\s*\(/);
  });

  it("CA-6: no queda ningun `expectBalanced: false` (asiento incompleto a proposito)", () => {
    expect(
      lineOf(SERVICE_SRC, EXPECT_BALANCED_FALSE),
      `${SERVICE_REL} contiene \`expectBalanced: false\` (linea ${lineOf(SERVICE_SRC, EXPECT_BALANCED_FALSE)}). ` +
        `SPEC-007 RN-5: toda ENTRADA lleva contrapartida; el asiento siempre cuadra (Σ = 0).`
    ).toBeNull();
  });

  it("SPEC-007: no queda el comentario `ADR-058 B1` (la excepcion del asiento de una linea)", () => {
    expect(
      lineOf(SERVICE_SRC, ADR_058_B1),
      `${SERVICE_REL} aun documenta la excepcion \`ADR-058 B1\` (linea ${lineOf(SERVICE_SRC, ADR_058_B1)}). ` +
        `La excepcion se eliminó con SPEC-007: borra el comentario junto con el codigo que la justificaba.`
    ).toBeNull();
  });

  it("SPEC-007: assertBalancedGLEntries no se condiciona a `length >= 2` (se verifica SIEMPRE)", () => {
    expect(
      lineOf(SERVICE_SRC, ASSERT_CONDITIONED_ON_LENGTH),
      `${SERVICE_REL} verifica el cuadre solo cuando hay 2+ lineas (linea ` +
        `${lineOf(SERVICE_SRC, ASSERT_CONDITIONED_ON_LENGTH)}): un asiento de una linea se guardaria sin verificar. ` +
        `Llama assertBalancedGLEntries(entries) sin condicion.`
    ).toBeNull();
  });

  it("los detectores distinguen el patron prohibido de codigo valido", () => {
    // Patrones prohibidos (lo que habia antes de SPEC-007) → deben detectarse.
    expect(EXPECT_BALANCED_FALSE.test("quantizeGLEntries(raw, { expectBalanced: false })")).toBe(
      true
    );
    expect(EXPECT_BALANCED_FALSE.test("opts = { expectBalanced:false }")).toBe(true);
    expect(ADR_058_B1.test("// ADR-058 B1: asiento incompleto a proposito")).toBe(true);
    expect(
      ASSERT_CONDITIONED_ON_LENGTH.test(
        "if (journalEntries.length >= 2) assertBalancedGLEntries(journalEntries);"
      )
    ).toBe(true);
    expect(
      ASSERT_CONDITIONED_ON_LENGTH.test(
        "if (counterEntries.length >=2)\n  assertBalancedGLEntries(counterEntries);"
      )
    ).toBe(true);
    expect(
      ASSERT_CONDITIONED_ON_LENGTH.test("if (entries.length > 1) assertBalancedGLEntries(entries);")
    ).toBe(true);

    // Codigo valido (lo que debe haber) → no debe detectarse.
    expect(EXPECT_BALANCED_FALSE.test('quantizeGLEntries(raw, { mode: "exact" })')).toBe(false);
    expect(EXPECT_BALANCED_FALSE.test("expectBalanced: true")).toBe(false);
    expect(ADR_058_B1.test("// ADR-058 B2: la anulacion deriva de lo guardado")).toBe(false);
    expect(ASSERT_CONDITIONED_ON_LENGTH.test("assertBalancedGLEntries(journalEntries);")).toBe(
      false
    );
  });
});
