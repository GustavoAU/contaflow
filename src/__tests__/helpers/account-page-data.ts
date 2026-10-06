// src/__tests__/helpers/account-page-data.ts
//
// SPEC-012 (Entrega B1, CA-19) — datos y aserciones COMPARTIDOS por los tests de las páginas y
// acciones que alimentan un `AccountCombobox`. Es un helper de TEST, no de producción.
//
// Por qué una BD en memoria y no `mockResolvedValue(...)`: un mock que responde lo mismo a cualquier
// `where` PASA aunque la página olvide `companyId`, `deletedAt: null` o el filtro de tipo, o siga
// filtrando `isPostable: true` (los títulos nunca llegan). Aquí cada `findMany` se evalúa contra filas
// reales de VARIAS empresas, con cuentas eliminadas y registros con columnas «de más» (`description`,
// `isMonetary`…), y `select` PROYECTA como Prisma: lo que la página no pide no viaja al cliente.

import { expect } from "vitest";

import { accountRow, createAccountDb, type AccountRow } from "./in-memory-account-db";

export const COMPANY_ID = "company-1";
export const OTHER_COMPANY_ID = "company-2";

/** Columnas del modelo `Account` que NUNCA deben viajar al cliente. */
const EXTRA_COLUMNS = {
  description: "no debe viajar",
  isMonetary: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
};

type Type = AccountRow["type"];

function make(
  companyId: string,
  code: string,
  name: string,
  type: Type,
  isPostable: boolean,
  deletedAt: Date | null = null
): AccountRow {
  return {
    ...accountRow({
      id: `${companyId}:${isPostable ? "m" : "t"}:${code}`,
      companyId,
      code,
      name,
      type,
      isPostable,
      deletedAt,
    }),
    ...EXTRA_COLUMNS,
  } as AccountRow;
}

/** Títulos (3 niveles) y 2 cuentas de movimiento por tipo, de UNA empresa. */
function planOf(companyId: string): AccountRow[] {
  const out: AccountRow[] = [];
  const groups: [Type, string, string][] = [
    ["ASSET", "1", "ACTIVO"],
    ["LIABILITY", "2", "PASIVO"],
    ["EQUITY", "3", "PATRIMONIO"],
    ["REVENUE", "4", "INGRESOS"],
    ["EXPENSE", "5", "GASTOS"],
  ];
  for (const [type, root, label] of groups) {
    out.push(make(companyId, root, label, type, false));
    out.push(make(companyId, `${root}.1`, `${label} CORRIENTE`, type, false));
    out.push(make(companyId, `${root}.1.01`, `${label} GENERAL`, type, false));
    out.push(make(companyId, `${root}.1.01.01`, `${label} DETALLE`, type, false));
    out.push(make(companyId, `${root}.1.01.01.001`, `${label} Uno`, type, true));
    out.push(make(companyId, `${root}.1.01.01.002`, `${label} Dos`, type, true));
  }
  return out;
}

/**
 * Datos de dos empresas más cuentas ELIMINADAS (soft delete) de la empresa actual. En orden de código
 * por empresa, como `orderBy: { code: "asc" }`.
 */
export function seedAccounts(): AccountRow[] {
  const deleted = new Date("2026-02-01");
  return [
    ...planOf(COMPANY_ID),
    make(COMPANY_ID, "1.1.01.01.099", "ACTIVO Eliminada", "ASSET", true, deleted),
    make(COMPANY_ID, "2.1.01.01.099", "PASIVO Eliminada", "LIABILITY", true, deleted),
    make(COMPANY_ID, "3.1.01.01.099", "PATRIMONIO Eliminada", "EQUITY", true, deleted),
    make(COMPANY_ID, "5.1.01.01.099", "GASTOS Eliminada", "EXPENSE", true, deleted),
    make(COMPANY_ID, "5.1.01", "GASTOS Título Eliminado", "EXPENSE", false, deleted),
    ...planOf(OTHER_COMPANY_ID),
  ];
}

export function createSeededDb(rows: AccountRow[] = seedAccounts()) {
  return createAccountDb(rows);
}

/** Ids que la BD devolvería de verdad: empresa actual, no eliminadas, y los tipos pedidos. */
export function expectedIds(
  rows: readonly AccountRow[],
  opts: { types?: readonly string[]; postableOnly?: boolean } = {}
): string[] {
  return rows
    .filter((r) => r.companyId === COMPANY_ID && r.deletedAt === null)
    .filter((r) => !opts.types || opts.types.includes(r.type))
    .filter((r) => !opts.postableOnly || r.isPostable)
    .map((r) => r.id);
}

/**
 * Lo que viaja al cliente son SOLO `required` (+ opcionalmente `optional`): ni el registro completo de
 * Prisma ni columnas de más. Compara las claves EXACTAS de cada fila.
 */
export function expectKeysWithin(
  rows: readonly Record<string, unknown>[],
  required: readonly string[],
  optional: readonly string[] = []
) {
  expect(rows.length).toBeGreaterThan(0);
  const allowed = new Set([...required, ...optional]);
  for (const row of rows) {
    const keys = Object.keys(row);
    for (const key of required) expect(keys, `falta la clave «${key}»`).toContain(key);
    for (const key of keys) expect(allowed.has(key), `clave de más «${key}»`).toBe(true);
  }
}

/** Reglas comunes del `where` de una consulta que alimenta un selector (CA-19). */
export function expectWhereKeepsScope(where: Record<string, unknown>) {
  expect(where.companyId).toBe(COMPANY_ID);
  expect(where.deletedAt).toBeNull();
  expect(Object.keys(where)).not.toContain("isPostable");
}

/** `select` de la consulta: pide lo mínimo (id, code, name, isPostable) y nada de más. */
export function expectSelectKeys(
  select: Record<string, unknown> | undefined,
  required: readonly string[],
  optional: readonly string[] = []
) {
  expect(select, "la consulta debe usar `select` explícito").toBeDefined();
  const keys = Object.keys(select as Record<string, unknown>);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) expect(keys, `el select no pide «${key}»`).toContain(key);
  for (const key of keys) {
    expect(allowed.has(key), `el select pide «${key}» de más`).toBe(true);
    expect((select as Record<string, unknown>)[key]).toBe(true);
  }
}
