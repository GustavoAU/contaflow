// src/modules/inventory/__tests__/helpers/fake-db.ts
//
// Utilidades SOLO de test (SPEC-007): tablas en memoria que se comportan como la BD.
//
// POR QUE: un `mockResolvedValue(fila)` plano devuelve la fila SIEMPRE, sin importar el `where`.
// Un servicio que omita `companyId` en su consulta pasaria en verde contra ese mock (falso
// positivo, ADR-004). Estos dobles filtran por TODAS las claves escalares del `where`, asi que
// una cuenta, factura o periodo de OTRA empresa solo aparece si el servicio olvida acotar.

import { vi } from "vitest";
import Decimal from "decimal.js";

export type Row = Record<string, unknown>;

export const COMPANY_ID = "company-001";
export const OTHER_COMPANY_ID = "company-ajena";

/** Objeto literal (no Date, Decimal, array ni null): lo unico que se trata como filtro anidado. */
function isPlainObject(value: unknown): value is Row {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Evalua un `where` simple contra una fila: igualdad en cada clave escalar, `{ in: [...] }` y
 * filtro por relacion anidada (`{ transaction: { companyId } }`, que se evalua contra el objeto
 * `transaction` que la fila lleva incrustado; si la fila no lo trae, NO coincide).
 * Un operador que no se soporta NO coincide (falla ruidoso en vez de pasar en silencio).
 * Las claves con valor `undefined` se ignoran, igual que hace Prisma.
 */
export function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    const actual = row[key];
    if (expected !== null && typeof expected === "object") {
      const filter = expected as { in?: unknown[] };
      if (Array.isArray(filter.in)) return filter.in.includes(actual);
      // Relacion anidada: se exige que la fila traiga la relacion y que cumpla el sub-where.
      if (isPlainObject(expected) && isPlainObject(actual)) return matchesWhere(actual, expected);
      return false;
    }
    return actual === expected;
  });
}

type FindArgs = { where?: Row; select?: Row };

/**
 * Aplica `select` como Prisma: la fila devuelta trae SOLO las claves pedidas con `true`. Un
 * servicio que lea un campo que no selecciono recibe `undefined` aqui, igual que en produccion
 * (un mock plano le daria el campo y ocultaria el bug). Sin `select` (o sin ningun `true`) la
 * fila se devuelve entera.
 */
function project(row: Row, select?: Row): Row {
  const keys = Object.entries(select ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  if (keys.length === 0) return row;
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

/** `findFirst` falso: la primera fila que cumple el `where` (proyectada por `select`), o `null`. */
export function fakeFindFirst(rows: Row[]) {
  return vi.fn(async (args?: FindArgs) => {
    const found = rows.find((r) => matchesWhere(r, args?.where));
    return found ? project(found, args?.select) : null;
  });
}

/** Implementaciones (sin envolver en vi.fn) para instalarlas con `mockImplementation`. */
export function findFirstImpl(rows: Row[]) {
  return async (args?: FindArgs) => {
    const found = rows.find((r) => matchesWhere(r, args?.where));
    return found ? project(found, args?.select) : null;
  };
}

export function findFirstOrThrowImpl(rows: Row[], model = "Account") {
  return async (args?: FindArgs) => {
    const found = rows.find((r) => matchesWhere(r, args?.where));
    if (!found) throw new Error(`No ${model} found`);
    return found;
  };
}

export function findManyImpl(rows: Row[]) {
  return async (args?: FindArgs) =>
    rows.filter((r) => matchesWhere(r, args?.where)).map((r) => project(r, args?.select));
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

// ─── Rama FACTURA de postMovement (SPEC-007, H-1) ─────────────────────────────
//
// Cada factura de abajo rompe UNA sola condicion de la rama FACTURA, y por defecto trae su linea
// que enlaza `mov-001` (ver FAKE_INVOICE_LINES). Asi un rechazo solo puede deberse a esa condicion
// y el test no depende del orden en que la implementacion encadene las comprobaciones.

const propia = (over: Row): Row => ({ companyId: COMPANY_ID, deletedAt: null, ...over });

/**
 * Facturas falsas:
 *  - inv-001          compra de la empresa, con asiento vigente (camino feliz)
 *  - inv-sin-asiento  compra de la empresa, sin asiento
 *  - inv-ajena        compra de OTRA empresa, con asiento
 *  - inv-venta        VENTA de la empresa, con asiento vigente
 *  - inv-eliminada    compra con asiento, pero dada de baja (soft delete)
 *  - inv-tx-ajena     compra cuyo `transactionId` apunta a un asiento de OTRA empresa
 *  - inv-tx-fantasma  compra cuyo `transactionId` no existe
 *  - inv-tx-anulada   compra cuyo asiento esta VOIDED (no vigente)
 */
export const FAKE_INVOICES: Row[] = [
  propia({ id: "inv-001", type: "PURCHASE", transactionId: "tx-factura-001" }),
  propia({ id: "inv-sin-asiento", type: "PURCHASE", transactionId: null }),
  {
    id: "inv-ajena",
    companyId: OTHER_COMPANY_ID,
    type: "PURCHASE",
    transactionId: "tx-factura-ajena",
    deletedAt: null,
  },
  propia({ id: "inv-venta", type: "SALE", transactionId: "tx-factura-venta" }),
  propia({
    id: "inv-eliminada",
    type: "PURCHASE",
    transactionId: "tx-factura-001",
    deletedAt: new Date("2026-03-01T00:00:00.000Z"),
  }),
  propia({ id: "inv-tx-ajena", type: "PURCHASE", transactionId: "tx-de-otra-empresa" }),
  propia({ id: "inv-tx-fantasma", type: "PURCHASE", transactionId: "tx-fantasma" }),
  propia({ id: "inv-tx-anulada", type: "PURCHASE", transactionId: "tx-anulada" }),
];

/**
 * Asientos falsos con su estado. `tx-fantasma` NO existe a proposito (la factura lo referencia);
 * `tx-de-otra-empresa` existe pero es de otra empresa.
 */
export const FAKE_TRANSACTIONS: Row[] = [
  { id: "tx-factura-001", companyId: COMPANY_ID, status: "POSTED" },
  { id: "tx-factura-venta", companyId: COMPANY_ID, status: "POSTED" },
  { id: "tx-factura-ajena", companyId: OTHER_COMPANY_ID, status: "POSTED" },
  { id: "tx-de-otra-empresa", companyId: OTHER_COMPANY_ID, status: "POSTED" },
  { id: "tx-anulada", companyId: COMPANY_ID, status: "VOIDED" },
];

/**
 * Linea de factura que enlaza un movimiento de inventario (`InvoiceLine.inventoryMovementId`).
 * Por defecto: de la empresa, vigente y enlazando `mov-001`. `over` rompe lo que el test necesite.
 */
export const invoiceLine = (invoiceId: string, movementId = "mov-001", over: Row = {}): Row => ({
  id: `line-${invoiceId}-${movementId}`,
  companyId: COMPANY_ID,
  invoiceId,
  inventoryMovementId: movementId,
  deletedAt: null,
  ...over,
});

/** Una linea vigente que enlaza `mov-001` por cada factura de FAKE_INVOICES. */
export const FAKE_INVOICE_LINES: Row[] = FAKE_INVOICES.map((inv) => invoiceLine(String(inv.id)));

// ─── Anulacion: lineas guardadas del asiento original (SPEC-007, M-2) ─────────

/**
 * Linea ya GUARDADA de un asiento (`JournalEntry`). Lleva la relacion `transaction` incrustada para
 * que el `where` `{ transaction: { companyId } }` de la implementacion se evalue de verdad: una
 * linea de un asiento de OTRA empresa solo aparece si el servicio olvida acotar por companyId.
 * El monto es un Decimal, como lo devuelve Prisma.
 */
export const journalLine = (
  transactionId: string,
  accountId: string,
  amount: string,
  over: Row = {}
): Row => ({
  id: `je-${transactionId}-${accountId}`,
  transactionId,
  accountId,
  amount: new Decimal(amount),
  description: `linea ${accountId}`,
  transaction: { companyId: COMPANY_ID },
  ...over,
});

/**
 * Asientos originales por defecto de los movimientos POSTED de los tests:
 *  - tx-original-001: ENTRADA de 600 con contrapartida Banco → Dr Inventario / Cr Banco
 *  - tx-original-002: SALIDA de 300                          → Dr COGS / Cr Inventario
 */
export const FAKE_JOURNAL_ENTRIES: Row[] = [
  journalLine("tx-original-001", "acc-inv", "600"),
  journalLine("tx-original-001", "acc-banco", "-600"),
  journalLine("tx-original-002", "acc-cogs", "300"),
  journalLine("tx-original-002", "acc-inv", "-300"),
];
