// src/modules/inventory/__tests__/inventory-guards.test.ts
//
// Guardas compartidas por el borrador (InventoryOperationsService) y la contabilización
// (InventoryAccountingService). Los dos servicios ya las ejercitan de punta a punta; este archivo
// fija el contrato de la guarda sola, con tablas falsas que filtran por TODO el `where` (un
// `companyId` omitido dejaría ver filas de otra empresa).
//
// Environment: node

import { describe, it, expect } from "vitest";
import {
  assertEntradaCounterpart,
  assertMovementPeriodOpen,
  MSG_CONTRAPARTIDA_NO_EXISTE,
  MSG_CONTRAPARTIDA_ES_INVENTARIO,
  MSG_ENTRADA_SIN_CONTRAPARTIDA,
} from "../services/inventory-guards";
import {
  COMPANY_ID,
  FAKE_ACCOUNTS,
  OTHER_COMPANY_ID,
  fakeFindFirst,
  findManyImpl,
  type Row,
} from "./helpers/fake-db";

/** Base falsa con el plan de cuentas indicado; el guard real usa findMany, el tipo usa findFirst. */
const makeDb = (rows: Row[] = FAKE_ACCOUNTS) => ({
  account: { findMany: findManyImpl(rows), findFirst: fakeFindFirst(rows) },
});

const counterpart = (
  accountId: string | null | undefined,
  db = makeDb(),
  inventoryAccountId: string | null = "acc-inv"
) =>
  assertEntradaCounterpart(db as never, {
    companyId: COMPANY_ID,
    accountId,
    inventoryAccountId,
  });

describe("assertEntradaCounterpart", () => {
  it.each([null, undefined, ""])(
    "sin contrapartida (%j) → mensaje con las opciones",
    async (id) => {
      await expect(counterpart(id)).rejects.toThrow(MSG_ENTRADA_SIN_CONTRAPARTIDA);
    }
  );

  it.each([
    ["ASSET (Banco)", "acc-banco"],
    ["LIABILITY (Cuentas por pagar)", "acc-cxp"],
    ["EQUITY (Capital)", "acc-capital"],
    ["EXPENSE (Costo/Gasto)", "acc-gasto"],
  ])("admite %s y devuelve su id", async (_tipo, id) => {
    await expect(counterpart(id)).resolves.toBe(id);
  });

  it("rechaza una cuenta de Ingresos", async () => {
    await expect(counterpart("acc-ingreso")).rejects.toThrow(/Ingresos/);
  });

  it("rechaza una cuenta regularizadora (contra-activo)", async () => {
    await expect(counterpart("acc-deprec")).rejects.toThrow(/regularizadora/);
  });

  it("rechaza la propia cuenta de inventario del producto", async () => {
    await expect(counterpart("acc-inv")).rejects.toThrow(MSG_CONTRAPARTIDA_ES_INVENTARIO);
  });

  it("si el producto aún no tiene cuenta de inventario, no compara contra ella", async () => {
    await expect(counterpart("acc-inv", makeDb(), null)).resolves.toBe("acc-inv");
  });

  it("una cuenta de OTRA empresa la rechaza el guard de cuentas ajenas", async () => {
    await expect(counterpart("acc-otra-empresa")).rejects.toThrow(
      "La cuenta seleccionada no existe o no pertenece a esta empresa."
    );
  });

  it("una cuenta inexistente la rechaza el guard de cuentas ajenas", async () => {
    await expect(counterpart("acc-fantasma")).rejects.toThrow(
      "La cuenta seleccionada no existe o no pertenece a esta empresa."
    );
  });

  it("segunda defensa: si el guard dejara pasar una cuenta ajena, la consulta del tipo (acotada por companyId) no la devuelve", async () => {
    const db = {
      account: {
        findMany: async () => [{ id: "acc-otra-empresa" }], // guard "ciego"
        findFirst: fakeFindFirst(FAKE_ACCOUNTS),
      },
    };
    await expect(counterpart("acc-otra-empresa", db as never)).rejects.toThrow(
      MSG_CONTRAPARTIDA_NO_EXISTE
    );
  });

  it("consulta el tipo acotada por companyId y sin cuentas dadas de baja", async () => {
    const db = makeDb();
    await counterpart("acc-banco", db);

    const args = db.account.findFirst.mock.calls[0]![0] as { where: Row; select: Row };
    expect(args.where).toEqual({ id: "acc-banco", companyId: COMPANY_ID, deletedAt: null });
    expect(args.select).toMatchObject({ type: true });
  });

  it("rechaza una cuenta dada de baja (deletedAt)", async () => {
    const rows: Row[] = [
      { id: "acc-baja", companyId: COMPANY_ID, type: "ASSET", deletedAt: new Date() },
    ];
    await expect(counterpart("acc-baja", makeDb(rows))).rejects.toThrow(
      MSG_CONTRAPARTIDA_NO_EXISTE
    );
  });

  it("rechaza una cuenta de título (no admite movimientos directos) con el mensaje del gate", async () => {
    const rows: Row[] = [
      {
        id: "acc-titulo",
        companyId: COMPANY_ID,
        type: "ASSET",
        deletedAt: null,
        isPostable: false,
        code: "1.1",
        name: "CIRCULANTE",
      },
    ];
    await expect(counterpart("acc-titulo", makeDb(rows))).rejects.toThrow(
      /1\.1 — CIRCULANTE.*título/
    );
  });
});

describe("assertMovementPeriodOpen", () => {
  const periodo = (year: number, month: number, over: Row = {}): Row => ({
    companyId: COMPANY_ID,
    status: "CLOSED",
    year,
    month,
    ...over,
  });
  const makeDbPeriods = (rows: Row[]) => ({ accountingPeriod: { findFirst: fakeFindFirst(rows) } });
  const run = (db: ReturnType<typeof makeDbPeriods>, date: Date) =>
    assertMovementPeriodOpen(db as never, COMPANY_ID, date);

  it("período CERRADO → error de negocio con MM/YYYY", async () => {
    const db = makeDbPeriods([periodo(2026, 4)]);
    await expect(run(db, new Date("2026-04-15T12:00:00.000Z"))).rejects.toThrow(
      "No se pueden registrar movimientos en el período 04/2026 porque está CERRADO."
    );
  });

  it("consulta exactamente empresa, estado CLOSED, año y mes", async () => {
    const db = makeDbPeriods([]);
    await run(db, new Date("2026-04-15T12:00:00.000Z"));

    const args = db.accountingPeriod.findFirst.mock.calls[0]![0] as { where: Row };
    expect(args.where).toEqual({ companyId: COMPANY_ID, status: "CLOSED", year: 2026, month: 4 });
  });

  it("el mes sale de la fecha en UTC: 2026-04-01T03:30Z es abril (en Venezuela aún es 31 de marzo)", async () => {
    const db = makeDbPeriods([periodo(2026, 4)]);
    await expect(run(db, new Date("2026-04-01T03:30:00.000Z"))).rejects.toThrow("CERRADO");
  });

  it.each([
    ["un período CERRADO de OTRA empresa", periodo(2026, 4, { companyId: OTHER_COMPANY_ID })],
    ["un período ABIERTO del mismo mes", periodo(2026, 4, { status: "OPEN" })],
    ["otro mes cerrado", periodo(2026, 3)],
    ["el mismo mes cerrado de otro año", periodo(2025, 4)],
  ])("no bloquea con %s", async (_caso, fila) => {
    const db = makeDbPeriods([fila]);
    await expect(run(db, new Date("2026-04-15T12:00:00.000Z"))).resolves.toBeUndefined();
  });
});
