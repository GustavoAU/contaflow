// src/lib/account-search.ts
//
// SPEC-012 — búsqueda y jerarquía del selector de cuenta (AccountCombobox). Módulo PURO: sin React,
// sin red y sin estado. Recibe los títulos Y las cuentas de movimiento de UNA empresa (el aislamiento
// por companyId ya lo hizo quien consultó) y devuelve las filas a mostrar, en orden jerárquico.
//
// Reglas (SPEC §4): RN-1 normalización · RN-2/RN-4 palabra numérica · RN-3 palabra con letras ·
// RN-5 orden jerárquico numérico · RN-6/RN-7 consulta vacía y tope · RN-9/RN-10 títulos de contexto
// y grupo completo · RN-11 solo las cuentas de movimiento cuentan como resultado.
//
// Todo se compara por `id` y por código, nunca por nombre: los nombres se repiten (ADR-059).

export type AccountOption = { id: string; code: string; name: string; isPostable: boolean };

/** `AccountOption` + tipo contable: lo usan los formularios que filtran o rotulan por tipo (caja chica, enteramiento). */
export type AccountWithType = AccountOption & { type: string };

export type AccountRow = {
  option: AccountOption;
  /** = option.isPostable: solo las cuentas de movimiento se pueden elegir; los títulos son encabezados. */
  selectable: boolean;
  /** Segmentos del código (1..5): sirve para sangrar el encabezado según su nivel. */
  depth: number;
};

export type AccountSearchResult = {
  rows: AccountRow[];
  /** Cuentas de movimiento que cumplen la consulta, ANTES del tope. */
  matchCount: number;
  /** `true` si hubo más de MAX_SELECTABLE_RESULTS y se recortó (RN-7). */
  truncated: boolean;
};

/** RN-7: tope de cuentas seleccionables con consulta. Los encabezados no cuentan. */
export const MAX_SELECTABLE_RESULTS = 100;

/** Palabra «numérica» (RN-2): solo dígitos y puntos. */
const NUMERIC_WORD = /^[\d.]+$/;

// ─── Normalización ───────────────────────────────────────────────────────────────────────────────

/** RN-1: minúsculas, sin tildes, espacios recortados y colapsados. Idempotente. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ─── Orden jerárquico (RN-5) ─────────────────────────────────────────────────────────────────────

type Prepared = {
  option: AccountOption;
  segments: readonly string[];
  /** Código sin separadores: «1.1.01.01.001» → «110101001». */
  digits: string;
  /** Nombre normalizado (RN-1). */
  name: string;
  depth: number;
};

function prepare(option: AccountOption): Prepared {
  const segments = option.code.split(".");
  return {
    option,
    segments,
    digits: segments.join(""),
    name: normalizeSearch(option.name),
    depth: segments.length,
  };
}

/** Compara dos segmentos numéricamente (sin pasar por Number: «01» = «1», «10» > «9»). */
function compareSegment(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = a.replace(/^0+/, "");
    const y = b.replace(/^0+/, "");
    if (x.length !== y.length) return x.length - y.length;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orden del plan: por segmentos, y el prefijo (el título) antes que sus descendientes. */
function compareHierarchical(a: Prepared, b: Prepared): number {
  const shared = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < shared; i++) {
    const order = compareSegment(a.segments[i], b.segments[i]);
    if (order !== 0) return order;
  }
  if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
  // Mismo código (no debería ocurrir: el código es único por empresa): el id desempata para que el
  // resultado no dependa del orden de la entrada.
  return a.option.id < b.option.id ? -1 : a.option.id > b.option.id ? 1 : 0;
}

/** Frontera de punto: `1.1` es ancestro de `1.1.01`, no de `1.10`. */
function isDescendant(item: Prepared, ancestor: Prepared): boolean {
  return item.option.code.startsWith(ancestor.option.code + ".");
}

function toRow(item: Prepared): AccountRow {
  return { option: item.option, selectable: item.option.isPostable, depth: item.depth };
}

// ─── Coincidencia (RN-2, RN-3, RN-4) ─────────────────────────────────────────────────────────────

function matchesWord(item: Prepared, word: string): boolean {
  if (NUMERIC_WORD.test(word)) {
    // RN-2: prefijo del código sin puntos. Un punto de más («1.») no cambia nada mientras se teclea.
    const digits = word.replace(/\./g, "");
    if (digits !== "" && item.digits.startsWith(digits)) return true;
    // RN-4: o aparece en el nombre («Retención 75%»).
    const literal = word.replace(/\.+$/, "");
    return literal !== "" && item.name.includes(literal);
  }
  // RN-3: «contiene» dentro del nombre. `includes` trata los símbolos como texto (sin RegExp).
  return item.name.includes(word);
}

/** Todas las palabras (Y) sobre el MISMO ítem: no se reparten entre un título y una cuenta de abajo. */
function matchesAll(item: Prepared, words: readonly string[]): boolean {
  return words.every((word) => matchesWord(item, word));
}

// ─── API ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Igual que `filterAccounts`, pero además informa cuántas cuentas cumplían antes del tope y si hubo
 * recorte, para que el componente muestre el aviso de RN-7 sin recontar.
 */
export function filterAccountsWithMeta(
  accounts: readonly AccountOption[],
  query: string
): AccountSearchResult {
  // `map` crea un arreglo nuevo: ordenar no muta ni reordena la entrada.
  const prepared = accounts.map(prepare).sort(compareHierarchical);
  const normalized = normalizeSearch(query);

  // RN-6: consulta vacía → la jerarquía completa (títulos incluidos) y SIN tope.
  if (normalized === "") {
    const rows = prepared.map(toRow);
    return { rows, matchCount: rows.filter((row) => row.selectable).length, truncated: false };
  }

  // Sin repetir: una palabra repetida no cambia el resultado (Y) y pegar miles de ellas congelaba la
  // pestaña (auditoría de seguridad de SPEC-012, LOW-2).
  const words = [...new Set(normalized.split(" "))];

  // Un solo recorrido en orden jerárquico. `stack` guarda la cadena de títulos que abarca al ítem
  // actual (sus ancestros) y si cada uno coincide con la consulta por sí mismo.
  type Frame = { item: Prepared; matched: boolean };
  type Hit = { item: Prepared; ancestors: Prepared[] };
  const stack: Frame[] = [];
  const hits: Hit[] = [];

  for (const item of prepared) {
    while (stack.length > 0 && !isDescendant(item, stack[stack.length - 1].item)) stack.pop();
    const matched = matchesAll(item, words);

    if (!item.option.isPostable) {
      stack.push({ item, matched });
      continue;
    }
    // RN-9 + RN-10: la cuenta entra si coincide ella, o si algún título que la abarca coincide
    // (buscar «cajas» trae todo el grupo CAJAS).
    if (matched || stack.some((frame) => frame.matched)) {
      hits.push({ item, ancestors: stack.map((frame) => frame.item) });
    }
  }

  // RN-7: las primeras N cuentas en orden jerárquico; los títulos que quedan son solo los ancestros
  // de las que quedan (RN-9: un título sin cuenta debajo no aparece, aunque coincida).
  const truncated = hits.length > MAX_SELECTABLE_RESULTS;
  const kept = truncated ? hits.slice(0, MAX_SELECTABLE_RESULTS) : hits;

  const rows: AccountRow[] = [];
  const emitted = new Set<string>();
  for (const { item, ancestors } of kept) {
    for (const ancestor of ancestors) {
      if (emitted.has(ancestor.option.id)) continue;
      emitted.add(ancestor.option.id);
      rows.push(toRow(ancestor));
    }
    rows.push(toRow(item));
  }

  return { rows, matchCount: hits.length, truncated };
}

/** RN-1..RN-11: filas a mostrar (títulos como contexto + cuentas), en orden jerárquico por código. */
export function filterAccounts(accounts: readonly AccountOption[], query: string): AccountRow[] {
  return filterAccountsWithMeta(accounts, query).rows;
}

/** RN-11: el contador y la regla de «un solo resultado» consideran solo cuentas de movimiento. */
export function selectableCount(rows: readonly AccountRow[]): number {
  return rows.filter((row) => row.selectable).length;
}

/**
 * RN-13: la cuenta de movimiento cuyo código coincide EXACTAMENTE con la consulta (ignorando puntos),
 * si existe. No reordena nada: solo decide cuál es la opción activa inicial. Un título nunca cuenta.
 */
export function findExactCodeMatch(
  rows: readonly AccountRow[],
  query: string
): AccountRow | undefined {
  const digits = normalizeSearch(query).replace(/\./g, "");
  if (!/^\d+$/.test(digits)) return undefined;
  return rows.find((row) => row.selectable && row.option.code.replace(/\./g, "") === digits);
}

// ─── RN-19: la lógica de los formularios ignora los títulos ──────────────────────────────────────

/**
 * RN-19: solo las cuentas de movimiento, en el MISMO orden de entrada y sin mutarla. Conteos, avisos
 * («No hay cuentas de tipo…»), `disabled` y autoselecciones (`[0]`) de cada formulario deben pasar por
 * aquí: los títulos viajan al combobox solo para mostrarse como encabezados.
 */
export function selectableAccounts<T extends { isPostable: boolean }>(accounts: readonly T[]): T[] {
  return accounts.filter((account) => account.isPostable);
}

/**
 * D1: ¿este id es una cuenta ELEGIBLE de esta lista? `true` solo si existe en `accounts` Y es de
 * movimiento. Un título, un id ausente o `""` (sin selección) dan `false`.
 */
export function isSelectableAccountId(
  accounts: readonly { id: string; isPostable: boolean }[],
  id: string
): boolean {
  if (id === "") return false;
  return accounts.some((account) => account.id === id && account.isPostable);
}

// ─── Q4: configuración guardada que ya no se puede usar ──────────────────────────────────────────

/** Un campo de configuración que guarda una cuenta, con SU lista de cuentas ofrecidas. */
export type SavedAccountField = {
  /** Identifica el campo (el nombre de la propiedad del formulario); no se muestra. */
  key: string;
  /** Rótulo visible del campo: es lo que la alerta le lista al usuario. */
  label: string;
  /** Id guardado (o elegido): vacío / `null` / `undefined` = «sin asignar», que no es un problema. */
  value: string | null | undefined;
  /** Las cuentas que ESE campo ofrece (p. ej. solo Patrimonio), nunca todo el plan. */
  accounts: readonly Pick<AccountOption, "id" | "isPostable">[];
};

/**
 * Q4 (SPEC-012 B2): los campos con un valor NO vacío que ya no es elegible en SU lista (`isSelectableAccountId`):
 * una cuenta de título, una eliminada o de otra empresa, o una de un tipo que el campo no ofrece. Devuelve
 * `{ key, label }` en el orden recibido; es lo que pinta `SavedAccountsAlert` y lo que bloquea el guardado del
 * formulario. Cada formulario lo calcula con sus valores ACTUALES (no solo los iniciales).
 */
export function unselectableSavedAccounts(
  fields: ReadonlyArray<SavedAccountField>
): { key: string; label: string }[] {
  return fields
    .filter(
      (field) =>
        field.value !== null &&
        field.value !== undefined &&
        field.value !== "" &&
        !isSelectableAccountId(field.accounts, field.value)
    )
    .map(({ key, label }) => ({ key, label }));
}
