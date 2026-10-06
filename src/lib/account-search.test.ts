// src/lib/account-search.test.ts
//
// TDD SPEC — entregado al ui-agent como contrato ejecutable. Todo lo que sigue FALLA antes de la
// implementación. No se modifica para ponerlo en verde: se implementa en producción hasta que pase
// (único cambio permitido en el paso 2: sustituir el import dinámico por un import estático).
//
// SPEC-012 (Entrega A, paso 1, modo RED) — búsqueda y jerarquía del selector de cuenta.
// Cubre CA-1..CA-8, CA-10, CA-11 y la parte pura de CA-5/CA-6/CA-7 (RN-1..RN-11).
//
// Modo RED: `./account-search` aún no existe (lo crea el ui-agent). El módulo se carga con un import
// dinámico de especificador NO literal y se tipa con el contrato de la SPEC, para que ni `tsc` ni la
// resolución de Vite fallen al cargar el archivo y cada caso falle por su propia razón («Failed to
// load url» / «no es una función»). Cuando el módulo exista (GREEN) se puede pasar a
// `import { filterAccounts, ... } from "./account-search"`.
//
// Decisiones del test-agent que el contrato dejaba abiertas (ver el reporte de entrega):
//  · Tope RN-7: se conservan las PRIMERAS 100 cuentas en orden jerárquico y, de los títulos, solo los
//    que son ancestros de alguna cuenta conservada; nunca queda un encabezado huérfano.
//  · Las palabras de la consulta se evalúan sobre UN MISMO ítem (su código y su nombre); no se
//    reparten entre un título y una cuenta de más abajo.
//  · NO se prueba: consulta vacía con más de 100 cuentas seleccionables (RN-6 «jerarquía completa» y
//    RN-7 «máximo 100» se contradicen ahí), ni un título que coincide pero no tiene cuentas debajo.

import { describe, it, expect } from "vitest";

import * as accountSearch from "./account-search";

type AccountOption = { id: string; code: string; name: string; isPostable: boolean };
type AccountRow = { option: AccountOption; selectable: boolean; depth: number };
type AccountSearchModule = {
  normalizeSearch(text: string): string;
  filterAccounts(accounts: readonly AccountOption[], query: string): AccountRow[];
  selectableCount(rows: readonly AccountRow[]): number;
};

async function load(): Promise<AccountSearchModule> {
  return accountSearch;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const title = (code: string, name: string): AccountOption => ({
  id: `t:${code}`,
  code,
  name,
  isPostable: false,
});
const mov = (code: string, name: string): AccountOption => ({
  id: `m:${code}`,
  code,
  name,
  isPostable: true,
});

/** Plan de ejemplo: títulos de 1 a 4 niveles y cuentas de movimiento de 5 (sin dígitos en los nombres). */
const PLAN: readonly AccountOption[] = [
  title("1", "ACTIVO"),
  title("1.1", "ACTIVO CORRIENTE"),
  title("1.1.01", "DISPONIBILIDADES"),
  title("1.1.01.01", "CAJAS"),
  mov("1.1.01.01.001", "Caja Principal"),
  mov("1.1.01.01.002", "Caja Chica"),
  title("1.1.01.02", "BANCOS"),
  mov("1.1.01.02.001", "Banco Mercantil"),
  title("1.1.02", "CUENTAS POR COBRAR"),
  title("1.1.02.01", "CLIENTES"),
  mov("1.1.02.01.001", "Clientes Nacionales"),
  title("2", "PASIVO"),
  title("2.1", "PASIVO CORRIENTE"),
  title("2.1.01", "OBLIGACIONES"),
  title("2.1.01.01", "PROVEEDORES"),
  mov("2.1.01.01.001", "Proveedores Nacionales"),
  title("2.1.01.02", "RETENCIONES POR PAGAR"),
  mov("2.1.01.02.001", "Retención IVA 75%"),
  mov("2.1.01.02.002", "Retención ISLR 2%"),
];

/** Lo mismo que PLAN en orden jerárquico — escrito a mano, no calculado. */
const PLAN_CODES_IN_ORDER = [
  "1",
  "1.1",
  "1.1.01",
  "1.1.01.01",
  "1.1.01.01.001",
  "1.1.01.01.002",
  "1.1.01.02",
  "1.1.01.02.001",
  "1.1.02",
  "1.1.02.01",
  "1.1.02.01.001",
  "2",
  "2.1",
  "2.1.01",
  "2.1.01.01",
  "2.1.01.01.001",
  "2.1.01.02",
  "2.1.01.02.001",
  "2.1.01.02.002",
];

const codesOf = (rows: readonly AccountRow[]) => rows.map((r) => r.option.code);
const selectableCodesOf = (rows: readonly AccountRow[]) =>
  rows.filter((r) => r.selectable).map((r) => r.option.code);

// Rama 1 (todas las filas de la rama del activo, en orden) para la consulta "1".
const BRANCH_1 = PLAN_CODES_IN_ORDER.filter((c) => c.startsWith("1"));

// ─── Utilidades de prueba (oráculos independientes de la implementación) ─────────────────────────

const segmentsOf = (code: string) => code.split(".").map(Number);

/** Orden jerárquico esperado: numérico por segmentos; el prefijo (el título) va antes. */
function compareHierarchical(a: string, b: string): number {
  const x = segmentsOf(a);
  const y = segmentsOf(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Permutaciones deterministas de la entrada (el resultado no puede depender del orden). */
function shuffles<T>(arr: readonly T[]): T[][] {
  const reversed = [...arr].reverse();
  const rotated = [...arr.slice(7), ...arr.slice(0, 7)];
  const evensThenOdds = [
    ...arr.filter((_, i) => i % 2 === 0),
    ...arr.filter((_, i) => i % 2 === 1),
  ];
  const stride = Array.from({ length: arr.length }, (_, i) => arr[(i * 5) % arr.length]);
  return [reversed, rotated, evensThenOdds, stride];
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * Plan grande: `1` / `1.1` / `1.1.01` y `groups` títulos `1.1.01.GG` con `perGroup` cuentas cada uno.
 * Los nombres de las cuentas son «Cuenta GG-NNN»; los de los títulos, «GRUPO GG» (sin la palabra «cuenta»).
 */
function bigPlan(groups: number, perGroup: number, firstGroupName?: string): AccountOption[] {
  const out: AccountOption[] = [
    title("1", "ACTIVO"),
    title("1.1", "CORRIENTE"),
    title("1.1.01", "DISPONIBLE"),
  ];
  for (let g = 1; g <= groups; g++) {
    const gg = pad(g, 2);
    out.push(title(`1.1.01.${gg}`, g === 1 && firstGroupName ? firstGroupName : `GRUPO ${gg}`));
    for (let n = 1; n <= perGroup; n++) {
      out.push(mov(`1.1.01.${gg}.${pad(n, 3)}`, `Cuenta ${gg}-${pad(n, 3)}`));
    }
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("normalizeSearch — RN-1", () => {
  it("pasa a minúsculas", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("CAJA Principal")).toBe("caja principal");
  });

  it("quita las tildes (NFD) de letras mayúsculas y minúsculas", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("ÁÉÍÓÚ áéíóú Cajá")).toBe("aeiou aeiou caja");
    expect(normalizeSearch("Retención Único Año")).toBe("retencion unico ano");
  });

  it("también quita la tilde cuando llega como carácter + marca combinante (NFD ya descompuesto)", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("Cajá")).toBe("caja");
  });

  it("recorta los extremos y colapsa los espacios internos (espacios, tabuladores, NBSP, saltos)", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("  caja   principal  ")).toBe("caja principal");
    expect(normalizeSearch("caja\t\tprincipal")).toBe("caja principal");
    expect(normalizeSearch("caja principal\n")).toBe("caja principal");
  });

  it("«Cajá » = «caja» (ejemplo de RN-1)", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("Cajá ")).toBe(normalizeSearch("caja"));
  });

  it("una cadena vacía o solo de espacios queda vacía", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("")).toBe("");
    expect(normalizeSearch("   \t ")).toBe("");
  });

  it("conserva dígitos, puntos y símbolos (no los interpreta)", async () => {
    const { normalizeSearch } = await load();
    expect(normalizeSearch("1.1.01.01.001")).toBe("1.1.01.01.001");
    expect(normalizeSearch("Retención (IVA) 75%")).toBe("retencion (iva) 75%");
  });

  it("es idempotente", async () => {
    const { normalizeSearch } = await load();
    const once = normalizeSearch("  RETENCIÓN   Única ");
    expect(normalizeSearch(once)).toBe(once);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — consulta vacía: jerarquía completa (RN-6, CA-6)", () => {
  it("devuelve TODAS las filas (títulos y cuentas) en orden jerárquico por código", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, ""))).toEqual(PLAN_CODES_IN_ORDER);
  });

  it("una consulta de solo espacios o tabuladores equivale a la vacía", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "   "))).toEqual(PLAN_CODES_IN_ORDER);
    expect(codesOf(filterAccounts(PLAN, " \t "))).toEqual(PLAN_CODES_IN_ORDER);
  });

  it("marca cada fila con su nivel (depth) y si es seleccionable", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "");
    expect(rows.map((r) => r.depth)).toEqual([
      1, 2, 3, 4, 5, 5, 4, 5, 3, 4, 5, 1, 2, 3, 4, 5, 4, 5, 5,
    ]);
    expect(rows.map((r) => r.selectable)).toEqual(
      PLAN_CODES_IN_ORDER.map((code) => code.split(".").length === 5)
    );
  });

  it("incluye también un título sin cuentas debajo (es «todas las filas»)", async () => {
    const { filterAccounts } = await load();
    const withEmptyTitle = [...PLAN, title("3", "PATRIMONIO")];
    expect(codesOf(filterAccounts(withEmptyTitle, ""))).toEqual([...PLAN_CODES_IN_ORDER, "3"]);
  });

  it("sin cuentas en la entrada → []", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts([], "")).toEqual([]);
    expect(filterAccounts([], "caja")).toEqual([]);
  });

  it("el resultado NO depende del orden del arreglo de entrada", async () => {
    const { filterAccounts } = await load();
    for (const permuted of shuffles(PLAN)) {
      expect(codesOf(filterAccounts(permuted, ""))).toEqual(PLAN_CODES_IN_ORDER);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — palabra numérica: prefijo del código sin puntos (RN-2, CA-1, CA-2)", () => {
  it("CA-1: «1» devuelve las cuentas del 1 en orden de código, con sus títulos ancestros, y no las del 2", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "1");
    expect(codesOf(rows)).toEqual(BRANCH_1);
    expect(selectableCodesOf(rows)).toEqual([
      "1.1.01.01.001",
      "1.1.01.01.002",
      "1.1.01.02.001",
      "1.1.02.01.001",
    ]);
  });

  it("CA-1 literal: con solo tres cuentas de movimiento y sus títulos, «1» trae las dos primeras", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      title("1", "ACTIVO"),
      title("1.1", "CORRIENTE"),
      title("1.1.01", "DISPONIBLE"),
      title("1.1.01.01", "CAJAS"),
      mov("1.1.01.01.001", "Caja"),
      title("1.1.02", "COBROS"),
      title("1.1.02.01", "CLIENTES"),
      mov("1.1.02.01.001", "Clientes"),
      title("2", "PASIVO"),
      title("2.1", "EXIGIBLE"),
      title("2.1.01", "OBLIGACIONES"),
      title("2.1.01.01", "PROVEEDORES"),
      mov("2.1.01.01.001", "Proveedores"),
    ];
    const rows = filterAccounts(accounts, "1");
    expect(selectableCodesOf(rows)).toEqual(["1.1.01.01.001", "1.1.02.01.001"]);
    expect(codesOf(rows)).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.02",
      "1.1.02.01",
      "1.1.02.01.001",
    ]);
  });

  it("si en la entrada no están los títulos, solo salen las cuentas (no se inventan encabezados)", async () => {
    const { filterAccounts } = await load();
    const onlyAccounts = [
      mov("1.1.01.01.001", "Caja"),
      mov("1.1.02.01.001", "Clientes"),
      mov("2.1.01.01.001", "Proveedores"),
    ];
    expect(codesOf(filterAccounts(onlyAccounts, "1"))).toEqual(["1.1.01.01.001", "1.1.02.01.001"]);
  });

  it.each(["110101001", "1.1.01.01.001", "1.1.01", "1101"])(
    "CA-2: «%s» encuentra 1.1.01.01.001",
    async (query) => {
      const { filterAccounts } = await load();
      expect(selectableCodesOf(filterAccounts(PLAN, query))).toContain("1.1.01.01.001");
    }
  );

  it("CA-2: «1.1.02» NO encuentra 1.1.01.01.001 (pero sí las cuentas del título 1.1.02)", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "1.1.02");
    expect(selectableCodesOf(rows)).not.toContain("1.1.01.01.001");
    expect(selectableCodesOf(rows)).toEqual(["1.1.02.01.001"]);
  });

  it("«110101001» y «1.1.01.01.001» son equivalentes (RN-2): mismo resultado fila por fila", async () => {
    const { filterAccounts } = await load();
    const withDots = filterAccounts(PLAN, "1.1.01.01.001");
    const withoutDots = filterAccounts(PLAN, "110101001");
    expect(withoutDots).toEqual(withDots);
    // y es exactamente la cadena de ancestros + la cuenta (ningún otro ítem coincide)
    expect(codesOf(withDots)).toEqual(["1", "1.1", "1.1.01", "1.1.01.01", "1.1.01.01.001"]);
  });

  it("«1101» y «1.1.01» son equivalentes y traen todo el título 1.1.01 (RN-10)", async () => {
    const { filterAccounts } = await load();
    const expected = [
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.01.01.002",
      "1.1.01.02",
      "1.1.01.02.001",
    ];
    expect(codesOf(filterAccounts(PLAN, "1.1.01"))).toEqual(expected);
    expect(codesOf(filterAccounts(PLAN, "1101"))).toEqual(expected);
  });

  it("un punto al final mientras se teclea no cambia el resultado: «1.» = «1», «1.1.» = «11»", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "1.")).toEqual(filterAccounts(PLAN, "1"));
    expect(filterAccounts(PLAN, "1.1.")).toEqual(filterAccounts(PLAN, "11"));
  });

  it("es PREFIJO del código sin puntos, no «contiene»: «101» y «0101» no encuentran 110101001", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "101")).toEqual([]);
    expect(filterAccounts(PLAN, "0101")).toEqual([]);
    expect(filterAccounts(PLAN, "01.001")).toEqual([]);
  });

  it("un código más largo que el de la cuenta no la encuentra", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "1101010010")).toEqual([]);
  });

  it("el título cuyo código coincide arrastra a sus descendientes: «2.1» trae todo el pasivo", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "2.1"))).toEqual(
      PLAN_CODES_IN_ORDER.filter((c) => c.startsWith("2"))
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — palabras con letras: «contiene» en el nombre (RN-3, CA-3, CA-4)", () => {
  /** Una cuenta con «caja» en MEDIO del nombre, cuyo título no se llama «caja». */
  const OTHER = [
    title("1", "ACTIVO"),
    title("1.1", "CORRIENTE"),
    title("1.1.01", "DISPONIBLE"),
    title("1.1.01.03", "OTROS"),
    mov("1.1.01.03.001", "Depósitos en Cajá de Seguridad"),
    mov("1.1.01.03.002", "Banco Exterior"),
  ];

  it("CA-3: «caja» encuentra «Caja Principal» y las cuentas cuyo nombre contiene «caja»", async () => {
    const { filterAccounts } = await load();
    expect(selectableCodesOf(filterAccounts(PLAN, "caja"))).toEqual([
      "1.1.01.01.001",
      "1.1.01.01.002",
    ]);
    // contiene (no solo empieza por): una cuenta con «caja» en medio del nombre, sin que su título coincida
    const rows = filterAccounts(OTHER, "caja");
    expect(selectableCodesOf(rows)).toEqual(["1.1.01.03.001"]);
  });

  it.each(["CAJÁ", "caja ", "  CAJA  ", "CaJa", "cajá"])(
    "CA-3: la consulta «%s» da el mismo resultado que «caja»",
    async (query) => {
      const { filterAccounts } = await load();
      expect(filterAccounts(PLAN, query)).toEqual(filterAccounts(PLAN, "caja"));
      expect(filterAccounts(OTHER, query)).toEqual(filterAccounts(OTHER, "caja"));
    }
  );

  it("las tildes también se ignoran en el NOMBRE de los datos: «depositos» encuentra «Depósitos»", async () => {
    const { filterAccounts } = await load();
    expect(selectableCodesOf(filterAccounts(OTHER, "depositos"))).toEqual(["1.1.01.03.001"]);
    expect(selectableCodesOf(filterAccounts(OTHER, "depósitos"))).toEqual(["1.1.01.03.001"]);
    expect(selectableCodesOf(filterAccounts(PLAN, "RETENCION"))).toEqual(
      selectableCodesOf(filterAccounts(PLAN, "retención"))
    );
    expect(selectableCodesOf(filterAccounts(PLAN, "retencion"))).toEqual([
      "2.1.01.02.001",
      "2.1.01.02.002",
    ]);
  });

  it("CA-4: «principal caja» encuentra «Caja Principal» (varias palabras, cualquier orden)", async () => {
    const { filterAccounts } = await load();
    const forward = filterAccounts(PLAN, "caja principal");
    const backward = filterAccounts(PLAN, "principal caja");
    expect(selectableCodesOf(backward)).toEqual(["1.1.01.01.001"]);
    expect(backward).toEqual(forward);
  });

  it("CA-4: «caja banco» no encuentra nada (las palabras se combinan con Y)", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "caja banco")).toEqual([]);
  });

  it("las palabras se evalúan sobre UN mismo ítem: «cajas principal» no reparte «cajas» (título) y «principal» (cuenta)", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "cajas principal")).toEqual([]);
  });

  it("espacios repetidos y palabras repetidas no cambian el resultado", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "  principal    caja ")).toEqual(
      filterAccounts(PLAN, "principal caja")
    );
    expect(filterAccounts(PLAN, "caja caja")).toEqual(filterAccounts(PLAN, "caja"));
  });

  it("[LOW-2] miles de palabras repetidas dan lo mismo que una sola y no congelan la pestaña", async () => {
    const { filterAccounts } = await load();
    const big: AccountOption[] = [];
    for (let g = 1; g <= 30; g++) {
      const group = String(g).padStart(2, "0");
      big.push({ id: `t${g}`, code: `1.1.01.${group}`, name: `GRUPO ${g}`, isPostable: false });
      for (let n = 1; n <= 30; n++) {
        big.push({
          id: `m${g}-${n}`,
          code: `1.1.01.${group}.${String(n).padStart(3, "0")}`,
          name: `Caja ${g}-${n}`,
          isPostable: true,
        });
      }
    }
    const many = Array.from({ length: 50_000 }, () => "caja").join(" ");

    const start = performance.now();
    const result = filterAccounts(big, many);
    const elapsed = performance.now() - start;

    expect(result).toEqual(filterAccounts(big, "caja"));
    expect(elapsed).toBeLessThan(750);
  });

  it("un símbolo en la consulta se busca literalmente: «75%» encuentra «Retención IVA 75%»", async () => {
    const { filterAccounts } = await load();
    expect(selectableCodesOf(filterAccounts(PLAN, "75%"))).toEqual(["2.1.01.02.001"]);
    expect(selectableCodesOf(filterAccounts(PLAN, "2%"))).toEqual(["2.1.01.02.002"]);
  });

  it("los metacaracteres de expresión regular se tratan como texto y no lanzan", async () => {
    const { filterAccounts } = await load();
    const withParens = [
      title("2", "PASIVO"),
      title("2.1", "CORRIENTE"),
      title("2.1.01", "OBLIGACIONES"),
      title("2.1.01.02", "RETENCIONES"),
      mov("2.1.01.02.001", "Retención (IVA)"),
      mov("2.1.01.02.002", "Retención ISLR"),
    ];
    expect(selectableCodesOf(filterAccounts(withParens, "(iva)"))).toEqual(["2.1.01.02.001"]);
    expect(selectableCodesOf(filterAccounts(withParens, "("))).toEqual(["2.1.01.02.001"]);
    for (const hostile of [".*", "[", "(", "\\", "+", "?", "^", "$", "a|b", "(?<x>", "{1"]) {
      expect(() => filterAccounts(PLAN, hostile)).not.toThrow();
    }
    // «.*» en una implementación con RegExp coincidiría con todo
    expect(filterAccounts(PLAN, ".*")).toEqual([]);
    expect(filterAccounts(PLAN, "caja.*")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — palabra numérica y mixtas (RN-4)", () => {
  it("«75» encuentra «Retención IVA 75%» por el NOMBRE aunque ningún código empiece por 75", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "75");
    expect(selectableCodesOf(rows)).toEqual(["2.1.01.02.001"]);
    expect(codesOf(rows)).toEqual(["2", "2.1", "2.1.01", "2.1.01.02", "2.1.01.02.001"]);
  });

  it("una palabra numérica que no está ni en el código (prefijo) ni en el nombre no encuentra nada", async () => {
    const { filterAccounts } = await load();
    expect(filterAccounts(PLAN, "76")).toEqual([]);
    expect(filterAccounts(PLAN, "9")).toEqual([]);
  });

  it("palabra numérica que coincide por el código de una cuenta y por el nombre de otra: salen las dos, en orden de código", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      mov("1.1.01.01.001", "Ajuste 110101002"), // por el nombre (RN-4)
      mov("1.1.01.01.002", "Caja Chica"), // por el código
      mov("1.1.01.01.003", "Caja Grande"), // no coincide
    ];
    expect(codesOf(filterAccounts(accounts, "110101002"))).toEqual([
      "1.1.01.01.001",
      "1.1.01.01.002",
    ]);
  });

  it("palabras mixtas «1101 caja»: el código (prefijo) Y el nombre, en el mismo ítem", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "1101 caja");
    expect(selectableCodesOf(rows)).toEqual(["1.1.01.01.001", "1.1.01.01.002"]);
    // en cualquier orden
    expect(filterAccounts(PLAN, "caja 1101")).toEqual(rows);
  });

  it("palabras mixtas: «1101 banco» trae solo el banco; «1102 caja» no trae nada", async () => {
    const { filterAccounts } = await load();
    expect(selectableCodesOf(filterAccounts(PLAN, "1101 banco"))).toEqual(["1.1.01.02.001"]);
    expect(filterAccounts(PLAN, "1102 caja")).toEqual([]);
  });

  it("palabras mixtas con una cuenta (no título): «110101001 principal»", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "110101001 principal"))).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
    ]);
    expect(filterAccounts(PLAN, "110101001 chica")).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — orden jerárquico (RN-5, CA-5)", () => {
  /** Segmentos de 1 y 2 cifras: el orden por texto («1.10» < «1.2») NO es el orden del plan. */
  const NUMERIC_ORDER = [
    mov("1.10.01.01.001", "Cuenta diez"),
    title("1.10", "DIEZ"),
    mov("1.1.10.01.001", "Cuenta uno diez"),
    title("1.2", "DOS"),
    mov("1.1.2.01.001", "Cuenta uno dos"),
    title("1.9", "NUEVE"),
    title("1.1.10", "UNO DIEZ"),
    title("1", "RAIZ"),
    title("1.1", "UNO"),
    title("1.1.2", "UNO DOS"),
    mov("1.9.01.01.001", "Cuenta nueve"),
    mov("1.2.01.01.001", "Cuenta dos"),
  ];

  it("compara los segmentos NUMÉRICAMENTE: 1.1.2 < 1.1.10 y 1.2 < 1.9 < 1.10", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(NUMERIC_ORDER, ""))).toEqual([
      "1",
      "1.1",
      "1.1.2",
      "1.1.2.01.001",
      "1.1.10",
      "1.1.10.01.001",
      "1.2",
      "1.2.01.01.001",
      "1.9",
      "1.9.01.01.001",
      "1.10",
      "1.10.01.01.001",
    ]);
  });

  it("el orden numérico se mantiene con consulta y con cualquier orden de entrada", async () => {
    const { filterAccounts } = await load();
    const expected = ["1", "1.1", "1.1.2", "1.1.2.01.001", "1.1.10", "1.1.10.01.001"];
    for (const input of [NUMERIC_ORDER, ...shuffles(NUMERIC_ORDER)]) {
      expect(codesOf(filterAccounts(input, "uno"))).toEqual(expected);
    }
  });

  it("un título va antes que sus descendientes, a todos los niveles", async () => {
    const { filterAccounts } = await load();
    const rows = codesOf(filterAccounts(PLAN, ""));
    for (const parent of ["1", "1.1", "1.1.01", "1.1.01.01"]) {
      const idx = rows.indexOf(parent);
      const firstChild = rows.findIndex((c) => c.startsWith(parent + "."));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(firstChild);
    }
  });

  it("la coincidencia EXACTA de código no reordena la lista (solo será la opción activa inicial)", async () => {
    const { filterAccounts } = await load();
    // 001 coincide por el nombre y 002 es la coincidencia exacta del código: 001 sigue primero
    const accounts = [mov("1.1.01.01.002", "Caja Chica"), mov("1.1.01.01.001", "Ajuste 110101002")];
    const rows = filterAccounts(accounts, "110101002");
    expect(codesOf(rows)).toEqual(["1.1.01.01.001", "1.1.01.01.002"]);
  });

  it("el resultado de una consulta NO depende del orden de la entrada", async () => {
    const { filterAccounts } = await load();
    for (const query of ["1", "caja", "principal caja", "75", "1101 caja", "disponibilidades"]) {
      const expected = filterAccounts(PLAN, query);
      expect(expected.length).toBeGreaterThan(0);
      for (const permuted of shuffles(PLAN)) {
        expect(filterAccounts(permuted, query)).toEqual(expected);
      }
    }
  });

  it("no muta ni reordena la entrada (un arreglo congelado no rompe y queda igual)", async () => {
    const { filterAccounts } = await load();
    const input = deepFreeze([...PLAN].reverse().map((a) => ({ ...a })));
    const before = input.map((a) => a.id);
    expect(() => filterAccounts(input, "")).not.toThrow();
    expect(() => filterAccounts(input, "caja")).not.toThrow();
    expect(input.map((a) => a.id)).toEqual(before);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — títulos como contexto (RN-9, CA-10)", () => {
  it("CA-10: «caja» muestra Caja Principal bajo la cadena 1, 1.1, 1.1.01, 1.1.01.01, sin repetirlos", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "caja");
    expect(codesOf(rows)).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.01.01.002",
    ]);
    // sin repetidos
    expect(new Set(codesOf(rows)).size).toBe(rows.length);
  });

  it("CA-10: un título sin coincidencias debajo NO aparece (ni hermanos, ni otras ramas)", async () => {
    const { filterAccounts } = await load();
    const shown = codesOf(filterAccounts(PLAN, "caja"));
    for (const hidden of ["1.1.01.02", "1.1.02", "1.1.02.01", "2", "2.1", "2.1.01.01"]) {
      expect(shown).not.toContain(hidden);
    }
  });

  it("una cuenta cuyo título NO coincide trae solo la cadena de sus ancestros (sin hermanos)", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "principal"))).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
    ]);
  });

  it("varias cuentas de ramas distintas comparten ancestros sin duplicarlos", async () => {
    const { filterAccounts } = await load();
    // «nacionales»: Clientes Nacionales (rama 1.1.02) y Proveedores Nacionales (rama 2.1.01)
    const rows = filterAccounts(PLAN, "nacionales");
    expect(codesOf(rows)).toEqual([
      "1",
      "1.1",
      "1.1.02",
      "1.1.02.01",
      "1.1.02.01.001",
      "2",
      "2.1",
      "2.1.01",
      "2.1.01.01",
      "2.1.01.01.001",
    ]);
  });

  it("los ancestros son por prefijo CON punto: el título 1.1 no es ancestro de 1.10.01.01.001", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      title("1", "ACTIVO"),
      title("1.1", "UNO"),
      title("1.10", "DIEZ"),
      mov("1.1.01.01.001", "Alfa"),
      mov("1.10.01.01.001", "Beta"),
    ];
    expect(codesOf(filterAccounts(accounts, "beta"))).toEqual(["1", "1.10", "1.10.01.01.001"]);
    expect(codesOf(filterAccounts(accounts, "alfa"))).toEqual(["1", "1.1", "1.1.01.01.001"]);
  });

  it("solo se muestran los ancestros que EXISTEN en la entrada (no se fabrican títulos)", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      title("1", "ACTIVO"),
      // falta 1.1 y 1.1.01
      title("1.1.01.01", "CAJAS"),
      mov("1.1.01.01.001", "Caja Principal"),
    ];
    expect(codesOf(filterAccounts(accounts, "principal"))).toEqual([
      "1",
      "1.1.01.01",
      "1.1.01.01.001",
    ]);
  });

  it("una cuenta sin ningún título en la entrada aparece sola", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts([mov("1.1.01.01.001", "Caja Principal")], "caja"))).toEqual([
      "1.1.01.01.001",
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — un título que coincide trae su grupo (RN-10, CA-11)", () => {
  it("CA-11: «cajas» (nombre del título) incluye TODAS sus cuentas de movimiento aunque su nombre no diga «cajas»", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "cajas");
    expect(codesOf(rows)).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.01.01.002",
    ]);
    // «Caja Principal» y «Caja Chica» no contienen «cajas»: solo entran por RN-10
    expect(selectableCodesOf(rows)).toEqual(["1.1.01.01.001", "1.1.01.01.002"]);
    // y el grupo hermano (BANCOS) no entra
    expect(codesOf(rows)).not.toContain("1.1.01.02.001");
  });

  it("un título de nivel alto trae los títulos intermedios y todas las cuentas de abajo", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "disponibilidades"))).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.01.01.002",
      "1.1.01.02",
      "1.1.01.02.001",
    ]);
  });

  it("un título coincide por varias palabras sobre su propio nombre: «cuentas por cobrar»", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(PLAN, "cuentas cobrar"))).toEqual([
      "1",
      "1.1",
      "1.1.02",
      "1.1.02.01",
      "1.1.02.01.001",
    ]);
  });

  it("los descendientes se toman por prefijo CON punto: el título 1.1 no arrastra a 1.10.…", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      title("1", "ACTIVO"),
      title("1.1", "UNO"),
      title("1.10", "DIEZ"),
      mov("1.1.01.01.001", "Alfa"),
      mov("1.10.01.01.001", "Beta"),
    ];
    const rows = filterAccounts(accounts, "uno");
    expect(codesOf(rows)).toEqual(["1", "1.1", "1.1.01.01.001"]);
    expect(codesOf(rows)).not.toContain("1.10.01.01.001");
  });

  it("un título coincide solo, sin que ninguna cuenta coincida por sí misma (el grupo entra completo)", async () => {
    const { filterAccounts } = await load();
    const accounts = [
      title("1", "ACTIVO"),
      title("1.1", "CORRIENTE"),
      title("1.1.01", "DISPONIBLE"),
      title("1.1.01.01", "GRUPO"),
      mov("1.1.01.01.001", "Alfa"),
      mov("1.1.01.01.002", "Beta"),
      mov("1.1.01.01.003", "Gamma"),
      title("1.1.01.02", "OTRO"),
      mov("1.1.01.02.001", "Delta"),
    ];
    expect(selectableCodesOf(filterAccounts(accounts, "grupo"))).toEqual([
      "1.1.01.01.001",
      "1.1.01.01.002",
      "1.1.01.01.003",
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — nombres repetidos (ADR-059: solo el código es único)", () => {
  const DUP = [
    title("1", "ACTIVO"),
    title("1.1", "CORRIENTE"),
    title("1.1.01", "OTROS"),
    title("1.1.01.01", "OTROS"),
    mov("1.1.01.01.001", "Caja"),
    title("1.1.02", "OTROS"),
    title("1.1.02.01", "OTROS"),
    mov("1.1.02.01.001", "Caja"),
  ];

  it("la consulta vacía devuelve las 8 filas: ningún título ni cuenta se funde con otro del mismo nombre", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(DUP, ""))).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.02",
      "1.1.02.01",
      "1.1.02.01.001",
    ]);
  });

  it("buscar el nombre repetido de las cuentas («caja») trae las dos, cada una con su cadena de títulos", async () => {
    const { filterAccounts } = await load();
    expect(codesOf(filterAccounts(DUP, "caja"))).toEqual([
      "1",
      "1.1",
      "1.1.01",
      "1.1.01.01",
      "1.1.01.01.001",
      "1.1.02",
      "1.1.02.01",
      "1.1.02.01.001",
    ]);
  });

  it("buscar el nombre repetido de los títulos («otros») trae todos los títulos con ese nombre y sus cuentas", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(DUP, "otros");
    expect(selectableCodesOf(rows)).toEqual(["1.1.01.01.001", "1.1.02.01.001"]);
    expect(rows.filter((r) => r.option.name === "OTROS")).toHaveLength(4);
  });

  it("una búsqueda por código distingue las dos cuentas del mismo nombre: «110201001» solo trae la segunda", async () => {
    const { filterAccounts } = await load();
    expect(selectableCodesOf(filterAccounts(DUP, "110201001"))).toEqual(["1.1.02.01.001"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — rendimiento razonable (se evalúa en cada pulsación)", () => {
  it("600 cuentas (más del doble del plan real) y 30 consultas seguidas, en menos de 2 s", async () => {
    const { filterAccounts } = await load();
    const plan = bigPlan(12, 50); // 600 cuentas + 12 grupos + 3 títulos
    const queries = [
      "",
      "1",
      "11",
      "1101",
      "110101",
      "cuenta",
      "cuenta 01",
      "grupo",
      "01-02",
      "zzz",
    ];
    const started = Date.now();
    for (let i = 0; i < 3; i++) {
      for (const q of queries) filterAccounts(plan, q);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — sin coincidencias (CA-8)", () => {
  it.each(["zzz", "caja banco", "9", "76", "caja 2", "xyz 1101"])(
    "«%s» → [] (ni encabezados ni cuentas)",
    async (query) => {
      const { filterAccounts } = await load();
      expect(filterAccounts(PLAN, query)).toEqual([]);
    }
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — tope de 100 cuentas seleccionables (RN-7, CA-7)", () => {
  it("más de 100 coincidencias → exactamente 100 seleccionables, las PRIMERAS en orden jerárquico", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(bigPlan(4, 40), "cuenta"); // 160 cuentas
    expect(selectableCount(rows)).toBe(100);
    const expectedAccounts: string[] = [];
    for (const g of [1, 2, 3]) {
      for (let n = 1; n <= (g === 3 ? 20 : 40); n++) {
        expectedAccounts.push(`1.1.01.${pad(g, 2)}.${pad(n, 3)}`);
      }
    }
    expect(selectableCodesOf(rows)).toEqual(expectedAccounts);
  });

  it("tras el corte quedan solo los títulos ancestros de las cuentas que quedan: ningún encabezado huérfano", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(bigPlan(4, 40), "cuenta");
    const titles = rows.filter((r) => !r.selectable).map((r) => r.option.code);
    expect(titles).toEqual(["1", "1.1", "1.1.01", "1.1.01.01", "1.1.01.02", "1.1.01.03"]);
    expect(titles).not.toContain("1.1.01.04"); // su grupo quedó entero fuera del corte
  });

  it("el corte es el mismo con cualquier orden de entrada", async () => {
    const { filterAccounts } = await load();
    const plan = bigPlan(4, 40);
    const expected = filterAccounts(plan, "cuenta");
    for (const permuted of shuffles(plan)) {
      expect(filterAccounts(permuted, "cuenta")).toEqual(expected);
    }
  });

  it("exactamente 100 coincidencias → las 100 (sin recorte)", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(bigPlan(1, 100), "cuenta");
    expect(selectableCount(rows)).toBe(100);
    expect(selectableCodesOf(rows).at(-1)).toBe("1.1.01.01.100");
  });

  it("101 coincidencias → 100: la cuenta 101 queda fuera", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(bigPlan(1, 101), "cuenta");
    expect(selectableCount(rows)).toBe(100);
    expect(selectableCodesOf(rows)).not.toContain("1.1.01.01.101");
    expect(selectableCodesOf(rows).at(-1)).toBe("1.1.01.01.100");
  });

  it("los encabezados NO cuentan para el tope: 100 cuentas en 50 grupos devuelven las 100 más 50+ títulos", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(bigPlan(50, 2), "cuenta");
    expect(selectableCount(rows)).toBe(100);
    expect(rows.length).toBe(100 + 50 + 3); // cuentas + grupos + 1, 1.1, 1.1.01
    expect(selectableCodesOf(rows).at(-1)).toBe("1.1.01.50.002");
  });

  it("el tope también aplica cuando coincide un TÍTULO con más de 100 cuentas debajo (RN-10)", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(bigPlan(1, 150, "MASIVO"), "masivo");
    expect(selectableCount(rows)).toBe(100);
    expect(codesOf(rows).slice(0, 5)).toEqual(["1", "1.1", "1.1.01", "1.1.01.01", "1.1.01.01.001"]);
    expect(selectableCodesOf(rows).at(-1)).toBe("1.1.01.01.100");
  });

  it("el tope aplica también a una consulta numérica que coincide con todo: «1» sobre 160 cuentas", async () => {
    const { filterAccounts, selectableCount } = await load();
    expect(selectableCount(filterAccounts(bigPlan(4, 40), "1"))).toBe(100);
  });

  it("con 100 o menos seleccionables (consulta vacía) no se recorta nada", async () => {
    const { filterAccounts } = await load();
    const plan = bigPlan(5, 20); // 100 cuentas + 5 grupos + 3 títulos
    expect(filterAccounts(plan, "")).toHaveLength(108);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("filterAccounts — propiedades que valen para cualquier consulta", () => {
  const QUERIES = [
    "",
    "   ",
    "1",
    "2",
    "11",
    "1101",
    "1.1.01",
    "21",
    "2.1",
    "caja",
    "cajas",
    "principal caja",
    "banco",
    "75",
    "75%",
    "retencion",
    "disponibilidades",
    "1101 caja",
    "pasivo",
    "proveedores",
    "nacionales",
    "zzz",
  ];

  it.each(QUERIES)(
    "«%s»: sin repetidos, orden jerárquico, ancestros presentes antes de cada fila y ningún encabezado huérfano",
    async (query) => {
      const { filterAccounts } = await load();
      for (const input of [PLAN, ...shuffles(PLAN)]) {
        const rows = filterAccounts(input, query);
        const codes = codesOf(rows);

        // sin repetidos
        expect(new Set(rows.map((r) => r.option.id)).size).toBe(rows.length);

        // orden jerárquico estricto
        for (let i = 1; i < codes.length; i++) {
          expect(compareHierarchical(codes[i - 1], codes[i])).toBeLessThan(0);
        }

        // todos los títulos ancestros (presentes en la entrada) de cada fila están en el resultado
        for (const row of rows) {
          for (const candidate of PLAN) {
            if (!candidate.isPostable && row.option.code.startsWith(candidate.code + ".")) {
              expect(codes).toContain(candidate.code);
            }
          }
        }

        // ningún título huérfano: cada encabezado tiene al menos una cuenta seleccionable debajo
        for (const row of rows.filter((r) => !r.selectable)) {
          const hasChild = rows.some(
            (r) => r.selectable && r.option.code.startsWith(row.option.code + ".")
          );
          expect(hasChild).toBe(true);
        }

        // flags coherentes con el dato
        for (const row of rows) {
          expect(row.selectable).toBe(row.option.isPostable);
          expect(row.depth).toBe(row.option.code.split(".").length);
        }
      }
    }
  );

  it("el conjunto de cuentas seleccionables de una consulta no incluye ninguna que no cumpla las palabras", async () => {
    const { filterAccounts } = await load();
    // «principal» solo está en una cuenta
    expect(selectableCodesOf(filterAccounts(PLAN, "principal"))).toEqual(["1.1.01.01.001"]);
    // un resultado más específico es subconjunto del más amplio
    const broad = new Set(selectableCodesOf(filterAccounts(PLAN, "caja")));
    for (const code of selectableCodesOf(filterAccounts(PLAN, "caja principal"))) {
      expect(broad.has(code)).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("AccountRow — selectable y depth (RN-8)", () => {
  it("selectable es option.isPostable, no se deduce del código: movimiento de código corto y título de 9 dígitos", async () => {
    const { filterAccounts } = await load();
    const odd = [
      { id: "a", code: "1.1.01", name: "Marcada de movimiento", isPostable: true },
      { id: "b", code: "2.1.01.01.001", name: "Marcada título", isPostable: false },
    ];
    const rows = filterAccounts(odd, "");
    const byId = Object.fromEntries(rows.map((r) => [r.option.id, r]));
    expect(byId.a.selectable).toBe(true);
    expect(byId.b.selectable).toBe(false);
  });

  it("depth = número de segmentos separados por punto: 1→1, 1.1→2, 1.1.01→3, 1.1.01.01→4, 1.1.01.01.001→5", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "caja");
    const depthByCode = Object.fromEntries(rows.map((r) => [r.option.code, r.depth]));
    expect(depthByCode).toEqual({
      "1": 1,
      "1.1": 2,
      "1.1.01": 3,
      "1.1.01.01": 4,
      "1.1.01.01.001": 5,
      "1.1.01.01.002": 5,
    });
  });

  it("un código sin puntos («1105») tiene depth 1", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts([mov("1105", "Caja")], "");
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(1);
    expect(rows[0].selectable).toBe(true);
  });

  it("cada fila conserva los datos de su cuenta (id, código, nombre, isPostable)", async () => {
    const { filterAccounts } = await load();
    const rows = filterAccounts(PLAN, "principal");
    const caja = rows.find((r) => r.option.code === "1.1.01.01.001");
    expect(caja).toBeDefined();
    expect(caja!.option).toMatchObject({
      id: "m:1.1.01.01.001",
      code: "1.1.01.01.001",
      name: "Caja Principal",
      isPostable: true,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe("selectableCount — solo cuentas de movimiento (RN-11)", () => {
  it("no cuenta los encabezados: «caja» son 6 filas pero 2 resultados", async () => {
    const { filterAccounts, selectableCount } = await load();
    const rows = filterAccounts(PLAN, "caja");
    expect(rows).toHaveLength(6);
    expect(selectableCount(rows)).toBe(2);
  });

  it("consulta vacía: cuenta solo las cuentas de movimiento del plan", async () => {
    const { filterAccounts, selectableCount } = await load();
    expect(selectableCount(filterAccounts(PLAN, ""))).toBe(7);
  });

  it("[] → 0", async () => {
    const { selectableCount } = await load();
    expect(selectableCount([])).toBe(0);
  });

  it("filas armadas a mano: cuenta las que tienen selectable = true", async () => {
    const { selectableCount } = await load();
    const rows: AccountRow[] = [
      { option: title("1", "ACTIVO"), selectable: false, depth: 1 },
      { option: mov("1.1.01.01.001", "Caja"), selectable: true, depth: 5 },
      { option: mov("1.1.01.01.002", "Chica"), selectable: true, depth: 5 },
      { option: title("1.1", "CORRIENTE"), selectable: false, depth: 2 },
    ];
    expect(selectableCount(rows)).toBe(2);
  });

  it("solo encabezados → 0", async () => {
    const { selectableCount } = await load();
    const rows: AccountRow[] = [
      { option: title("1", "ACTIVO"), selectable: false, depth: 1 },
      { option: title("1.1", "CORRIENTE"), selectable: false, depth: 2 },
    ];
    expect(selectableCount(rows)).toBe(0);
  });
});

// <<B1-BLOCK-START>>
// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SPEC-012 · ENTREGA B1 · PASO 0 (modo RED) — helpers que los formularios usan para ignorar títulos
// (RN-19): `selectableAccounts` e `isSelectableAccountId`.
//
// TDD SPEC — contrato ejecutable para el ui-agent. FALLA hasta que `src/lib/account-search.ts`
// exporte ambas funciones. Se cargan con el espacio de nombres del módulo y se tipan con el contrato
// declarado aquí, para que `tsc` no falle mientras no existan y cada caso falle por su propia razón.
//
//   selectableAccounts<T extends { isPostable: boolean }>(accounts: readonly T[]): T[]
//     → solo las de movimiento, en el MISMO orden, sin mutar la entrada.
//   isSelectableAccountId(accounts: readonly { id: string; isPostable: boolean }[], id: string): boolean
//     → true solo si el id existe en la lista Y es de movimiento; "" → false.
//   type AccountWithType = AccountOption & { type: string }   (solo tipo: lo verifica `tsc` en el GREEN)

type B1Module = {
  selectableAccounts<T extends { isPostable: boolean }>(accounts: readonly T[]): T[];
  isSelectableAccountId(
    accounts: readonly { id: string; isPostable: boolean }[],
    id: string
  ): boolean;
};

function loadB1(): B1Module {
  // Cada función se resuelve por separado: que falte una no debe hacer fallar los casos de la otra.
  const mod = accountSearch as unknown as Partial<B1Module>;
  return {
    selectableAccounts: ((accounts) => {
      if (typeof mod.selectableAccounts !== "function") {
        throw new Error("selectableAccounts no es una función exportada por ./account-search");
      }
      return mod.selectableAccounts(accounts);
    }) as B1Module["selectableAccounts"],
    isSelectableAccountId: (accounts, id) => {
      if (typeof mod.isSelectableAccountId !== "function") {
        throw new Error("isSelectableAccountId no es una función exportada por ./account-search");
      }
      return mod.isSelectableAccountId(accounts, id);
    },
  };
}

type Typed = AccountOption & { type: string };
const tt = (code: string, name: string, type = "ASSET"): Typed => ({
  ...title(code, name),
  type,
});
const mt = (code: string, name: string, type = "ASSET"): Typed => ({ ...mov(code, name), type });

describe("selectableAccounts — solo cuentas de movimiento (RN-19)", () => {
  it("descarta los títulos y conserva las cuentas de movimiento", () => {
    const { selectableAccounts } = loadB1();
    const result = selectableAccounts(PLAN);
    expect(result.length).toBe(PLAN.filter((a) => a.isPostable).length);
    expect(result.every((a) => a.isPostable)).toBe(true);
    expect(result.map((a) => a.code)).toEqual(PLAN.filter((a) => a.isPostable).map((a) => a.code));
  });

  it("conserva el orden de ENTRADA (no reordena por código)", () => {
    const { selectableAccounts } = loadB1();
    const input = [
      mt("3.1.01.01.001", "Capital"),
      tt("1", "ACTIVO"),
      mt("1.1.01.01.001", "Caja"),
      tt("2", "PASIVO"),
      mt("2.1.01.01.001", "Proveedores"),
    ];
    expect(selectableAccounts(input).map((a) => a.code)).toEqual([
      "3.1.01.01.001",
      "1.1.01.01.001",
      "2.1.01.01.001",
    ]);
  });

  it("devuelve los MISMOS objetos (no copias) y conserva campos extra como `type`", () => {
    const { selectableAccounts } = loadB1();
    const caja = mt("1.1.01.01.001", "Caja", "ASSET");
    const gasto = mt("5.1.01.01.001", "Papelería", "EXPENSE");
    const result = selectableAccounts([tt("1", "ACTIVO"), caja, gasto]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(caja);
    expect(result[1]).toBe(gasto);
    expect(result[1].type).toBe("EXPENSE");
  });

  it("NO muta la entrada: ni el arreglo ni sus elementos (entrada congelada)", () => {
    const { selectableAccounts } = loadB1();
    const input = Object.freeze([
      Object.freeze(tt("1", "ACTIVO")),
      Object.freeze(mt("1.1.01.01.001", "Caja")),
      Object.freeze(tt("1.1", "CORRIENTE")),
    ]);
    const snapshot = JSON.stringify(input);
    const result = selectableAccounts(input);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).toHaveLength(3);
  });

  it("el resultado es un arreglo nuevo: modificarlo no altera la entrada", () => {
    const { selectableAccounts } = loadB1();
    const input = [mt("1.1.01.01.001", "Caja"), tt("1", "ACTIVO")];
    const result = selectableAccounts(input);
    result.push(mt("9.9.99.99.999", "Intruso"));
    expect(input).toHaveLength(2);
    expect(selectableAccounts(input)).toHaveLength(1);
  });

  it("lista vacía → []", () => {
    expect(loadB1().selectableAccounts([])).toEqual([]);
  });

  it("solo títulos → [] (nada que elegir)", () => {
    expect(loadB1().selectableAccounts([tt("1", "ACTIVO"), tt("1.1", "CORRIENTE")])).toEqual([]);
  });

  it("solo cuentas de movimiento → todas, en el mismo orden", () => {
    const { selectableAccounts } = loadB1();
    const input = [mt("1.1.01.01.002", "B"), mt("1.1.01.01.001", "A")];
    expect(selectableAccounts(input).map((a) => a.name)).toEqual(["B", "A"]);
  });

  it("un título que va PRIMERO (el que una autoselección `[0]` elegiría por error) no aparece", () => {
    const { selectableAccounts } = loadB1();
    const result = selectableAccounts([
      tt("3", "PATRIMONIO", "EQUITY"),
      mt("3.1.01.01.001", "Capital", "EQUITY"),
    ]);
    expect(result[0]?.code).toBe("3.1.01.01.001");
  });
});

describe("isSelectableAccountId — ¿este id es elegible en esta lista? (D1)", () => {
  it("true para una cuenta de movimiento presente", () => {
    const { isSelectableAccountId } = loadB1();
    expect(isSelectableAccountId(PLAN, "m:1.1.01.01.001")).toBe(true);
    expect(isSelectableAccountId(PLAN, "m:2.1.01.01.001")).toBe(true);
  });

  it("false para un título presente (no se puede elegir)", () => {
    const { isSelectableAccountId } = loadB1();
    expect(isSelectableAccountId(PLAN, "t:1.1.01.01")).toBe(false);
    expect(isSelectableAccountId(PLAN, "t:1")).toBe(false);
  });

  it("false para un id que no existe en la lista", () => {
    const { isSelectableAccountId } = loadB1();
    expect(isSelectableAccountId(PLAN, "m:9.9.99.99.999")).toBe(false);
    expect(isSelectableAccountId(PLAN, "no-existe")).toBe(false);
  });

  it("false para la cadena vacía (sin selección), aunque la lista traiga una cuenta con id vacío", () => {
    const { isSelectableAccountId } = loadB1();
    expect(isSelectableAccountId(PLAN, "")).toBe(false);
    expect(isSelectableAccountId([{ id: "", isPostable: true }], "")).toBe(false);
  });

  it("lista vacía → false", () => {
    expect(loadB1().isSelectableAccountId([], "m:1.1.01.01.001")).toBe(false);
  });

  it("compara el id exacto: sin ignorar mayúsculas ni espacios", () => {
    const { isSelectableAccountId } = loadB1();
    expect(isSelectableAccountId(PLAN, "M:1.1.01.01.001")).toBe(false);
    expect(isSelectableAccountId(PLAN, " m:1.1.01.01.001")).toBe(false);
    expect(isSelectableAccountId(PLAN, "m:1.1.01.01.001 ")).toBe(false);
  });

  it("solo mira la lista recibida: un id elegible en OTRA lista no cuenta", () => {
    const { isSelectableAccountId } = loadB1();
    const soloPasivos = PLAN.filter((a) => a.code.startsWith("2"));
    expect(isSelectableAccountId(soloPasivos, "m:1.1.01.01.001")).toBe(false);
    expect(isSelectableAccountId(soloPasivos, "m:2.1.01.01.001")).toBe(true);
  });

  it("no depende de la posición: funciona igual con el título antes o después de la cuenta", () => {
    const { isSelectableAccountId } = loadB1();
    const caja = mov("1.1.01.01.001", "Caja");
    const cajas = title("1.1.01.01", "CAJAS");
    expect(isSelectableAccountId([cajas, caja], caja.id)).toBe(true);
    expect(isSelectableAccountId([caja, cajas], caja.id)).toBe(true);
    expect(isSelectableAccountId([caja, cajas], cajas.id)).toBe(false);
  });

  it("acepta una lista de solo lectura y no la muta", () => {
    const { isSelectableAccountId } = loadB1();
    const frozen = Object.freeze([...PLAN]);
    expect(isSelectableAccountId(frozen, "m:1.1.01.01.001")).toBe(true);
    expect(frozen).toHaveLength(PLAN.length);
  });
});
