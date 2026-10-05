// src/modules/accounting/__tests__/next-account-code.test.ts
//
// SPEC-008 (RN-4/RN-5/RN-6): el código sugerido de una cuenta de movimiento es
// `${padre}.${EEE}`, con EEE el primer valor libre de 001 a 999 entre los hijos directos del padre.
// Reemplaza los tests de `nextAccountCode`/`deducirPaso` (rangos planos de 4 dígitos), que se eliminan.
//
// `nextChildCode` lo añade el ledger-agent: se lee a través del namespace del módulo, tipado con el
// contrato de la SPEC §7, para no dejar `tsc` en rojo antes de que exista (modo RED).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import * as nextCodeModule from "../utils/next-account-code";
import { isPostableCode } from "@/lib/account-code";

type NextChildCodeArgs = { parentCode: string; existingCodes: readonly string[] };
type NextChildCode = (args: NextChildCodeArgs) => string | null;

const nextChildCode: NextChildCode = (args) =>
  (nextCodeModule as unknown as { nextChildCode: NextChildCode }).nextChildCode(args);

// Copia literal de la forma del contrato (SPEC §7): el test no depende de que el export exista.
const MOVEMENT_FORM = /^\d\.\d\.\d{2}\.\d{2}\.\d{3}$/;

const PADRE = "1.1.01.01";
const hijo = (n: number, parent = PADRE) => `${parent}.${String(n).padStart(3, "0")}`;
const hijos = (from: number, to: number, parent = PADRE) =>
  Array.from({ length: to - from + 1 }, (_, i) => hijo(from + i, parent));

describe("nextChildCode — siguiente código libre dentro de un título padre (SPEC-008)", () => {
  // ─── CA-1 ──────────────────────────────────────────────────────────────────────────────────
  it("CA-1: con 001 y 002 ocupados, el padre 1.1.01.01 sugiere 1.1.01.01.003", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.001", "1.1.01.01.002"],
      })
    ).toBe("1.1.01.01.003");
  });

  it("padre sin hijos → 001 (el primer valor del rango)", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: [] })).toBe("1.1.01.01.001");
  });

  it("continúa la serie sin saltos: 001..009 ocupados → 010 (relleno con ceros a 3 dígitos)", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: hijos(1, 9) })).toBe("1.1.01.01.010");
  });

  it("99 ocupados → 100 (el relleno de ceros no se arrastra a 3 dígitos reales)", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: hijos(1, 99) })).toBe("1.1.01.01.100");
  });

  it("funciona para otro padre y otro tipo de plan (2.1.05.02)", () => {
    expect(
      nextChildCode({
        parentCode: "2.1.05.02",
        existingCodes: ["2.1.05.02.001", "2.1.05.02.002", "2.1.05.02.003"],
      })
    ).toBe("2.1.05.02.004");
  });

  // ─── CA-2 ──────────────────────────────────────────────────────────────────────────────────
  it("CA-2: con un hueco (001 y 003) sugiere 002, no 004", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.001", "1.1.01.01.003"],
      })
    ).toBe("1.1.01.01.002");
  });

  it("el hueco al inicio gana sobre continuar la serie: 002 y 003 ocupados → 001", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.002", "1.1.01.01.003"],
      })
    ).toBe("1.1.01.01.001");
  });

  it("con varios huecos devuelve el PRIMERO (001, 004, 006 → 002)", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.001", "1.1.01.01.004", "1.1.01.01.006"],
      })
    ).toBe("1.1.01.01.002");
  });

  it("no depende del orden en que llegan los códigos existentes", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.003", "1.1.01.01.001", "1.1.01.01.004"],
      })
    ).toBe("1.1.01.01.002");
  });

  it("un código repetido en la lista no altera el resultado", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.01.001", "1.1.01.01.001", "1.1.01.01.002", "1.1.01.01.002"],
      })
    ).toBe("1.1.01.01.003");
  });

  // ─── CA-3 (RN-5) ───────────────────────────────────────────────────────────────────────────
  // La función no distingue vivas de eliminadas: recibe TODAS las filas de la empresa (el
  // @@unique([companyId, code]) también cuenta las eliminadas). Que el llamador no filtre
  // `deletedAt` se verifica en los tests de la action; aquí, que lo recibido se trata como ocupado.
  it("CA-3: 1.1.01.01.003 existe ELIMINADA (llega en la lista) → no se sugiere ese código", () => {
    const result = nextChildCode({
      parentCode: PADRE,
      existingCodes: ["1.1.01.01.001", "1.1.01.01.002", "1.1.01.01.003"],
    });
    expect(result).toBe("1.1.01.01.004");
    expect(result).not.toBe("1.1.01.01.003");
  });

  // ─── CA-4 (RN-6) ───────────────────────────────────────────────────────────────────────────
  it("CA-4: 999 hijos ocupados → null (error de negocio, no un código inventado)", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: hijos(1, 999) })).toBeNull();
  });

  it("CA-4: con 998 ocupados (falta solo el 999) → 1.1.01.01.999, el último valor válido", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: hijos(1, 998) })).toBe(
      "1.1.01.01.999"
    );
  });

  it("CA-4: con 002..999 ocupados (falta solo el 001) → 001, no null", () => {
    expect(nextChildCode({ parentCode: PADRE, existingCodes: hijos(2, 999) })).toBe(
      "1.1.01.01.001"
    );
  });

  // ─── Solo cuentan los hijos DIRECTOS de ESTE padre ─────────────────────────────────────────
  it("hijos de OTRO padre no cuentan (1.1.01.02.001, 1.1.02.01.001, 2.1.01.01.001)", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.02.001", "1.1.02.01.001", "2.1.01.01.001", "1.2.01.01.001"],
      })
    ).toBe("1.1.01.01.001");
  });

  it("el propio padre y sus ancestros (títulos) en la lista no cuentan como hijos", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1", "1.1", "1.1.01", "1.1.01.01"],
      })
    ).toBe("1.1.01.01.001");
  });

  it("los hijos de otro padre no desplazan la serie de este (mezclados con los propios)", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.02.001", "1.1.01.01.001", "1.1.01.02.002", "1.1.01.01.002"],
      })
    ).toBe("1.1.01.01.003");
  });

  it("un código que solo comparte prefijo de texto NO es hijo (1.1.01.011.001 vs padre 1.1.01.01)", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: ["1.1.01.011.001", "1.1.01.011.002"],
      })
    ).toBe("1.1.01.01.001");
  });

  it("códigos malformados bajo el padre no ocupan ningún valor (0010, 01, abc, un segmento extra)", () => {
    // Ninguno coincide con `${padre}.EEE` de 3 dígitos: el @@unique no choca con ellos, así que
    // 001 está realmente libre. Interpretarlos como Number("0010")=10 ó Number("01")=1 sería un bug.
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: [
          "1.1.01.01.0010",
          "1.1.01.01.01",
          "1.1.01.01.abc",
          "1.1.01.01.001.002",
          "1.1.01.01.",
        ],
      })
    ).toBe("1.1.01.01.001");
  });

  it("un código de 4 dígitos bajo el padre no bloquea el 010 (0010 ≠ 010)", () => {
    expect(
      nextChildCode({
        parentCode: PADRE,
        existingCodes: [...hijos(1, 9), "1.1.01.01.0010"],
      })
    ).toBe("1.1.01.01.010");
  });

  // ─── Pureza ────────────────────────────────────────────────────────────────────────────────
  it("no muta el arreglo recibido (readonly)", () => {
    const existing = Object.freeze(["1.1.01.01.001", "1.1.01.01.003"]) as readonly string[];
    expect(() => nextChildCode({ parentCode: PADRE, existingCodes: existing })).not.toThrow();
    expect(existing).toEqual(["1.1.01.01.001", "1.1.01.01.003"]);
  });

  it("es determinista: la misma entrada da el mismo resultado", () => {
    const args = { parentCode: PADRE, existingCodes: ["1.1.01.01.001", "1.1.01.01.003"] };
    expect(nextChildCode(args)).toBe(nextChildCode(args));
  });

  // ─── CA-8: propiedad ───────────────────────────────────────────────────────────────────────
  describe("CA-8: todo código sugerido cumple MOVEMENT_CODE_REGEX e isPostableCode", () => {
    // Generador pseudoaleatorio determinista (LCG): el test es reproducible y no flaky.
    function lcg(seed: number) {
      let s = seed >>> 0;
      return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
      };
    }

    const PADRES = ["1.1.01.01", "2.1.05.02", "3.2.01.01", "4.1.01.01", "5.1.02.03", "1.2.09.99"];

    it("para 60 conjuntos de códigos existentes (con ruido de otros padres) el resultado es el MENOR valor libre", () => {
      const rnd = lcg(20261005);
      for (let caso = 0; caso < 60; caso++) {
        const parent = PADRES[Math.floor(rnd() * PADRES.length)];
        const ocupados = new Set<number>();
        const size = Math.floor(rnd() * 400);
        for (let i = 0; i < size; i++) ocupados.add(1 + Math.floor(rnd() * 999));

        // Ruido: hijos de otros padres que NO deben influir.
        const otros = PADRES.filter((p) => p !== parent);
        const ruido = Array.from({ length: 20 }, () =>
          hijo(1 + Math.floor(rnd() * 999), otros[Math.floor(rnd() * otros.length)])
        );
        const existingCodes = [...[...ocupados].map((n) => hijo(n, parent)), ...ruido];

        // Oráculo independiente: el menor n en 1..999 que no esté ocupado.
        let esperado: number | null = null;
        for (let n = 1; n <= 999; n++) {
          if (!ocupados.has(n)) {
            esperado = n;
            break;
          }
        }

        const result = nextChildCode({ parentCode: parent, existingCodes });
        expect(esperado, `caso ${caso}: el oráculo debe encontrar un valor libre`).not.toBeNull();
        expect(result, `caso ${caso} (${parent}, ${ocupados.size} ocupados)`).toBe(
          hijo(esperado as number, parent)
        );
        expect(result as string).toMatch(MOVEMENT_FORM);
        expect(isPostableCode(result as string)).toBe(true);
        expect(existingCodes).not.toContain(result);
        expect((result as string).startsWith(`${parent}.`)).toBe(true);
      }
    });

    it.each([
      ["vacío", []],
      ["un hijo", ["1.1.01.01.001"]],
      ["con hueco", ["1.1.01.01.001", "1.1.01.01.003"]],
      ["serie larga", hijos(1, 250)],
      ["casi lleno", hijos(1, 998)],
    ])("conjunto %s → regex de movimiento + isPostableCode", (_label, existingCodes) => {
      const result = nextChildCode({ parentCode: PADRE, existingCodes });
      expect(result).not.toBeNull();
      expect(result as string).toMatch(MOVEMENT_FORM);
      expect(isPostableCode(result as string)).toBe(true);
    });
  });
});

// ─── CA-limpieza ─────────────────────────────────────────────────────────────────────────────────
// La utilidad vieja (rangos planos de 4 dígitos) y la tabla RANGES que la alimentaba se eliminan:
// siguen proponiendo códigos que nacen como TÍTULO (ADR-059). Si reaparecen, alguien volvió a
// sugerir códigos de 4 dígitos.

describe("CA-limpieza: ya no queda la sugerencia por rangos planos", () => {
  const SRC_ROOT = path.join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        out.push(...sourceFiles(full));
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("next-account-code.ts no exporta nextAccountCode ni deducirPaso", () => {
    const exported = Object.keys(nextCodeModule);
    expect(exported).not.toContain("nextAccountCode");
    expect(exported).not.toContain("deducirPaso");
  });

  it("next-account-code.ts exporta nextChildCode", () => {
    expect(Object.keys(nextCodeModule)).toContain("nextChildCode");
    expect(typeof (nextCodeModule as Record<string, unknown>).nextChildCode).toBe("function");
  });

  it("ningún archivo de producción de src/ referencia nextAccountCode ni deducirPaso", () => {
    const offenders = sourceFiles(SRC_ROOT).filter((file) =>
      /\b(nextAccountCode|deducirPaso)\b/.test(readFileSync(file, "utf8"))
    );
    expect(offenders.map((f) => path.relative(SRC_ROOT, f))).toEqual([]);
  });

  it("account.actions.ts ya no declara la tabla RANGES (rangos 1000-1999…) para sugerir códigos", () => {
    const actions = readFileSync(
      path.join(SRC_ROOT, "modules/accounting/actions/account.actions.ts"),
      "utf8"
    );
    expect(actions).not.toMatch(/\bRANGES\b/);
    expect(actions).not.toMatch(/rangeStart|rangeEnd/);
  });

  it("next-account-code.ts ya no trabaja con rangos numéricos (rangeStart/rangeEnd)", () => {
    const util = readFileSync(
      path.join(SRC_ROOT, "modules/accounting/utils/next-account-code.ts"),
      "utf8"
    );
    expect(util).not.toMatch(/rangeStart|rangeEnd/);
  });
});
