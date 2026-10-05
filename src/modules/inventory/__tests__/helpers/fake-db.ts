// src/modules/inventory/__tests__/helpers/fake-db.ts
//
// Utilidades SOLO de test (SPEC-007): tablas en memoria que se comportan como la BD.
//
// POR QUE: un `mockResolvedValue(fila)` plano devuelve la fila SIEMPRE, sin importar el `where`.
// Un servicio que omita `companyId` en su consulta pasaria en verde contra ese mock (falso
// positivo, ADR-004). Estos dobles filtran por TODAS las claves escalares del `where`, asi que
// una cuenta, factura o periodo de OTRA empresa solo aparece si el servicio olvida acotar.

import { vi } from "vitest";

export type Row = Record<string, unknown>;

export const COMPANY_ID = "company-001";
export const OTHER_COMPANY_ID = "company-ajena";

/**
 * Evalua un `where` simple contra una fila: igualdad en cada clave escalar y `{ in: [...] }`.
 * Un operador que no se soporta NO coincide (falla ruidoso en vez de pasar en silencio).
 * Las claves con valor `undefined` se ignoran, igual que hace Prisma.
 */
export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    const actual = row[key];
    if (expected !== null && typeof expected === "object") {
      const filter = expected as { in?: unknown[] };
      return Array.isArray(filter.in) ? filter.in.includes(actual) : false;
    }
    return actual === expected;
  });
}

type FindArgs = { where?: Row };

/** `findFirst` falso: la primera fila que cumple el `where`, o `null`. */
export function fakeFindFirst(rows: Row[]) {
  return vi.fn(async (args?: FindArgs) => rows.find((r) => matchesWhere(r, args?.where)) ?? null);
}

/** Implementaciones (sin envolver en vi.fn) para instalarlas con `mockImplementation`. */
export function findFirstImpl(rows: Row[]) {
  return async (args?: FindArgs) => rows.find((r) => matchesWhere(r, args?.where)) ?? null;
}

export function findFirstOrThrowImpl(rows: Row[], model = "Account") {
  return async (args?: FindArgs) => {
    const found = rows.find((r) => matchesWhere(r, args?.where));
    if (!found) throw new Error(`No ${model} found`);
    return found;
  };
}

export function findManyImpl(rows: Row[]) {
  return async (args?: FindArgs) => rows.filter((r) => matchesWhere(r, args?.where));
}

/**
 * Plan de cuentas falso. `acc-inv` es la cuenta de inventario del item de los tests; el resto son
 * contrapartidas de cada tipo contable. `acc-otra-empresa` existe, pero en OTRA empresa.
 */
export const FAKE_ACCOUNTS: Row[] = [
  { id: "acc-inv", companyId: COMPANY_ID, type: "ASSET", deletedAt: null },
  { id: "acc-cogs", companyId: COMPANY_ID, type: "EXPENSE", deletedAt: null },
  { id: "acc-banco", companyId: COMPANY_ID, type: "ASSET", deletedAt: null },
  { id: "acc-cxp", companyId: COMPANY_ID, type: "LIABILITY", deletedAt: null },
  { id: "acc-capital", companyId: COMPANY_ID, type: "EQUITY", deletedAt: null },
  { id: "acc-gasto", companyId: COMPANY_ID, type: "EXPENSE", deletedAt: null },
  { id: "acc-ingreso", companyId: COMPANY_ID, type: "REVENUE", deletedAt: null },
  { id: "acc-deprec", companyId: COMPANY_ID, type: "CONTRA_ASSET", deletedAt: null },
  { id: "acc-otra-empresa", companyId: OTHER_COMPANY_ID, type: "ASSET", deletedAt: null },
];

/** Facturas falsas: con asiento, sin asiento, y una de otra empresa (con asiento). */
export const FAKE_INVOICES: Row[] = [
  { id: "inv-001", companyId: COMPANY_ID, transactionId: "tx-factura-001", deletedAt: null },
  { id: "inv-sin-asiento", companyId: COMPANY_ID, transactionId: null, deletedAt: null },
  {
    id: "inv-ajena",
    companyId: OTHER_COMPANY_ID,
    transactionId: "tx-factura-ajena",
    deletedAt: null,
  },
];
