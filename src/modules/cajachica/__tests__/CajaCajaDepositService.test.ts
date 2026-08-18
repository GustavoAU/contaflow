import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { createDeposit, voidDeposit } from "../services/CajaCajaDepositService";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const CAJA_ACCOUNT = "acc-caja";
const SOURCE_ACCOUNT = "acc-banco";

type TxOverrides = Record<string, unknown>;

/** Construye un tx mock con valores por defecto sanos, sobreescribibles por bloque. */
function makeTx(overrides: TxOverrides = {}) {
  const txCreate = vi.fn().mockResolvedValue({ id: "tx-1" });
  const depositUpdate = vi.fn().mockResolvedValue({});
  const txUpdate = vi.fn().mockResolvedValue({});
  const depositCreate = vi.fn().mockResolvedValue({
    id: "dep-1", cajaCajaId: "caja-1", date: new Date("2026-06-13"),
    amount: new Decimal("500000"), description: "Reposición", status: "POSTED",
    transactionId: null, createdAt: new Date(), voidedAt: null, voidReason: null,
  });
  const tx = {
    cajaCaja: {
      findFirst: vi.fn().mockResolvedValue({
        id: "caja-1", companyId: COMPANY_ID, accountId: CAJA_ACCOUNT, status: "ACTIVE",
      }),
    },
    account: {
      // HAL-001: assertAccountOfType exige type === "ASSET" (la contrapartida que
      // financia el fondo es un banco/caja general). Sin type, sería ≠ ASSET y rompería
      // todos los happy-paths.
      findFirst: vi.fn().mockResolvedValue({ id: SOURCE_ACCOUNT, type: "ASSET" }),
    },
    accountingPeriod: {
      // year/month deben coincidir con baseInput.date ("2026-06-13") — HC-02.
      // assertDateInOpenPeriod compara contra la FECHA DEL DEPÓSITO (no contra hoy),
      // por eso aquí van valores fijos que igualan baseInput.date.
      findFirst: vi.fn().mockResolvedValue({ id: "period-1", year: 2026, month: 6, status: "OPEN" }),
    },
    cajaCajaDeposit: {
      create: depositCreate,
      // `count` vive aquí SOLO por createDeposit (CajaCajaDepositService.ts:96, el
      // único count del servicio). El harness de voidDeposit lo omite a propósito
      // — ver installVoidTx.
      count: vi.fn().mockResolvedValue(0),
      update: depositUpdate,
      findFirst: vi.fn(),
    },
    transaction: { create: txCreate, findFirst: vi.fn(), update: txUpdate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, txCreate, depositUpdate, txUpdate, depositCreate };
}

const baseInput = {
  companyId: COMPANY_ID,
  cajaCajaId: "caja-1",
  sourceAccountId: SOURCE_ACCOUNT,
  date: "2026-06-13",
  amount: "500000",
  description: "Reposición",
};

describe("createDeposit — partida doble (R-1 / N4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("genera asiento balanceado Dr Caja / Cr Origen (Σ = 0)", async () => {
    const { txCreate } = makeTx();

    await createDeposit(baseInput, USER_ID);

    expect(txCreate).toHaveBeenCalledTimes(1);
    const entries = txCreate.mock.calls[0][0].data.entries.create as Array<{
      accountId: string; amount: Decimal;
    }>;
    expect(entries).toHaveLength(2);

    const dr = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;
    const cr = entries.find((e) => e.accountId === SOURCE_ACCOUNT)!;
    expect(dr.amount.toString()).toBe("500000");
    expect(cr.amount.toString()).toBe("-500000");

    const sum = entries.reduce((a, e) => a.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);
  });

  it("vincula el asiento al depósito (transactionId)", async () => {
    const { depositUpdate } = makeTx();
    await createDeposit(baseInput, USER_ID);
    expect(depositUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { transactionId: "tx-1" } })
    );
  });

  it("rechaza si la cuenta origen no existe / no es de la empresa (IDOR)", async () => {
    makeTx({ account: { findFirst: vi.fn().mockResolvedValue(null) } });
    // assertAccountOfType lanza "...: cuenta no encontrada o no pertenece a esta empresa."
    await expect(createDeposit(baseInput, USER_ID)).rejects.toThrow(/no encontrada|pertenece/i);
  });

  it("HAL-001: rechaza si la cuenta origen NO es de tipo ASSET (Pasivo/Gasto/etc.)", async () => {
    // Un Pasivo como contrapartida daría un asiento contable incorrecto.
    const { txCreate, depositCreate } = makeTx({
      account: { findFirst: vi.fn().mockResolvedValue({ id: SOURCE_ACCOUNT, type: "LIABILITY" }) },
    });
    await expect(createDeposit(baseInput, USER_ID)).rejects.toThrow(/Activo/i);
    // No debe crearse ni el depósito ni el asiento si la cuenta es del tipo equivocado.
    expect(depositCreate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it("rechaza si la cuenta origen es la misma cuenta de la caja", async () => {
    // La cuenta de caja también es ASSET, así que assertAccountOfType pasa; el guard
    // que debe disparar aquí es el de "distinta de la cuenta de la Caja Chica".
    makeTx({ account: { findFirst: vi.fn().mockResolvedValue({ id: CAJA_ACCOUNT, type: "ASSET" }) } });
    await expect(
      createDeposit({ ...baseInput, sourceAccountId: CAJA_ACCOUNT }, USER_ID)
    ).rejects.toThrow(/distinta/i);
  });

  it("rechaza si no hay período contable abierto", async () => {
    makeTx({ accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(createDeposit(baseInput, USER_ID)).rejects.toThrow(/período/i);
  });

  it("HC-02: rechaza si la fecha del depósito cae fuera del período abierto", async () => {
    // Período abierto = junio 2026, pero el depósito viene fechado en mayo.
    makeTx({
      accountingPeriod: {
        findFirst: vi.fn().mockResolvedValue({ id: "period-1", year: 2026, month: 6, status: "OPEN" }),
      },
    });
    await expect(
      createDeposit({ ...baseInput, date: "2026-05-31" }, USER_ID),
    ).rejects.toThrow(/fuera del período contable abierto/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// voidDeposit — tabla falsa de Transaction
// ─────────────────────────────────────────────────────────────────────────────

/** Fila mínima de la tabla falsa de `Transaction`. */
type FakeTxRow = {
  id: string;
  companyId: string;
  number: string;
  status: string;
  entries: Array<{ accountId: string; amount: Decimal; description: string }>;
};

/** Fila mínima de la tabla falsa de `CajaCajaDeposit`. */
type FakeDeposit = {
  id: string;
  companyId: string;
  status: string;
  transactionId: string | null;
};

type TxFindFirstArgs = {
  where?: { id?: string; companyId?: string; number?: { startsWith?: string } };
  orderBy?: { number?: "asc" | "desc" };
};

/** Asiento del depósito original (serie DEP-), con las entries que se van a revertir. */
function depositTxRow(id: string, number: string, companyId = COMPANY_ID): FakeTxRow {
  return {
    id,
    companyId,
    number,
    status: "POSTED",
    entries: [
      { accountId: CAJA_ACCOUNT, amount: new Decimal("500000"), description: "Depósito Caja Chica — Reposición" },
      { accountId: SOURCE_ACCOUNT, amount: new Decimal("-500000"), description: "Salida fondos hacia Caja Chica — Reposición" },
    ],
  };
}

/** Asiento de una anulación previa (serie DEP-REV-). */
function revTxRow(number: string, companyId = COMPANY_ID): FakeTxRow {
  return { id: `tx-${companyId}-${number}`, companyId, number, status: "POSTED", entries: [] };
}

/** Asiento de OTRA serie que empieza por `DEP-` (FixedAssetDepreciationService:218). */
function depreciationTxRow(number: string): FakeTxRow {
  return { id: `tx-${number}`, companyId: COMPANY_ID, number, status: "POSTED", entries: [] };
}

/**
 * Depósito POSTED por defecto. Es una FUNCIÓN, no una constante: `depositUpdate`
 * muta la fila (status → VOIDED) y una constante compartida arrastraría ese estado
 * al siguiente test.
 */
function defaultDeposits(): FakeDeposit[] {
  return [{ id: "dep-1", companyId: COMPANY_ID, status: "POSTED", transactionId: "tx-1" }];
}

/**
 * Instala el tx mock de `voidDeposit` con `transaction.findFirst` como TABLA FALSA
 * en vez de valor fijo. Recorre `rows` honrando `where.companyId`,
 * `where.number.startsWith` y `orderBy: { number: desc }`.
 *
 * Es deliberado: un mock de valor fijo devuelve lo mismo con la fórmula correcta
 * (MÁXIMO + 1 sobre DEP-REV-) y con la equivocada (count de depósitos), que es
 * exactamente el agujero por el que se coló este bug y su hermano de
 * IncomeDistribution. Con la tabla falsa, si producción pierde el `orderBy: desc`,
 * el filtro de empresa o el prefijo completo, sale otra fila y el test muere.
 *
 * `transaction.create` EMPUJA la fila creada a `rows`: la siguiente anulación la
 * ve, igual que en la BD. Eso permite encadenar dos anulaciones seriales.
 *
 * `cajaCajaDeposit.count` NO se mockea a propósito. Verificado con grep: el único
 * `count` del servicio vive en `createDeposit` (línea 96); `voidDeposit` ya no
 * numera contando depósitos. Si alguien lo reintroduce aquí, el flujo revienta
 * con TypeError en vez de volver a verde.
 */
function installVoidTx(rows: FakeTxRow[], deposits: FakeDeposit[] = defaultDeposits()) {
  let createdCount = 0;

  const txCreate = vi.fn(async (args: { data: { companyId: string; number: string } }) => {
    createdCount += 1;
    const id = `tx-rev-${createdCount}`;
    rows.push({
      id,
      companyId: args.data.companyId,
      number: args.data.number,
      status: "POSTED",
      entries: [],
    });
    return { id };
  });

  const txUpdate = vi.fn(async (args: { where: { id: string }; data: { status: string } }) => {
    const row = rows.find((r) => r.id === args.where.id);
    if (row) row.status = args.data.status;
    return row ?? {};
  });

  const txFindFirst = vi.fn(async (args: TxFindFirstArgs) => {
    const where = args?.where ?? {};

    // 1. `where.id` presente → lookup del asiento original a revertir.
    if (where.id !== undefined) {
      return (
        rows.find(
          (r) =>
            r.id === where.id &&
            (where.companyId === undefined || r.companyId === where.companyId),
        ) ?? null
      );
    }

    // 2. resto → lookup del correlativo (MÁXIMO + 1).
    const prefix = where.number?.startsWith ?? "";
    const matches = rows.filter(
      (r) =>
        r.number.startsWith(prefix) &&
        (where.companyId === undefined || r.companyId === where.companyId),
    );
    const direction = args?.orderBy?.number;
    let chosen: FakeTxRow | undefined;
    if (direction === undefined) {
      // Sin ORDER BY el motor no promete ningún orden: emulamos el de inserción.
      chosen = matches[0];
    } else {
      // Orden de codepoint, que es el que aplica Postgres sobre estos ASCII.
      const sorted = [...matches].sort((a, b) =>
        a.number < b.number ? -1 : a.number > b.number ? 1 : 0,
      );
      chosen = direction === "desc" ? sorted[sorted.length - 1] : sorted[0];
    }
    return chosen ? { number: chosen.number } : null;
  });

  const depositFindFirst = vi.fn(async (args: { where: { id: string; companyId: string } }) => {
    const d = deposits.find((x) => x.id === args.where.id && x.companyId === args.where.companyId);
    return d ? { ...d } : null;
  });

  const depositUpdate = vi.fn(async (args: { where: { id: string }; data: { status: string } }) => {
    const d = deposits.find((x) => x.id === args.where.id);
    if (d) d.status = args.data.status;
    return d ?? {};
  });

  const now = new Date();
  const tx = {
    cajaCajaDeposit: {
      findFirst: depositFindFirst,
      update: depositUpdate,
      // count: DELIBERADAMENTE AUSENTE — ver docstring.
    },
    transaction: { findFirst: txFindFirst, create: txCreate, update: txUpdate },
    // HAL-002: la reversión se fecha HOY y pasa por assertDateInOpenPeriod
    // → el período mock debe tener año/mes ACTUAL (getters UTC, como el service).
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({
        id: "period-1",
        year: now.getUTCFullYear(),
        month: now.getUTCMonth() + 1,
        status: "OPEN",
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );

  return { tx, txCreate, txUpdate, txFindFirst, depositUpdate, depositFindFirst, rows, deposits };
}

/**
 * Los `number` con los que el CÓDIGO llamó a `transaction.create` — leídos del
 * argumento, en el punto donde producción los PRODUCE. Leerlos de lo que devuelve
 * el mock es el fallo que dejó pasar el bug hermano de IncomeDistribution: ese
 * test no podía fallar.
 */
function numbersCreated(create: { mock: { calls: unknown[][] } }): string[] {
  return create.mock.calls.map((call) => (call[0] as { data: { number: string } }).data.number);
}

const voidDep = (depositId: string) =>
  voidDeposit({ depositId, companyId: COMPANY_ID, voidReason: "Duplicado" }, USER_ID);

describe("voidDeposit — reversión GL (VOID nunca borra)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea contrapartida espejo balanceada y marca original VOIDED", async () => {
    const { txCreate, txUpdate, depositUpdate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
    ]);

    await voidDep("dep-1");

    // Reversión balanceada con montos invertidos
    const revEntries = (txCreate.mock.calls[0][0] as unknown as {
      data: { entries: { create: Array<{ accountId: string; amount: Decimal }> } };
    }).data.entries.create;
    const sum = revEntries.reduce((a, e) => a.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);
    expect(revEntries.find((e) => e.accountId === CAJA_ACCOUNT)!.amount.toString()).toBe("-500000");
    expect(revEntries.find((e) => e.accountId === SOURCE_ACCOUNT)!.amount.toString()).toBe("500000");

    // Original marcado VOIDED y depósito marcado VOIDED
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tx-1" }, data: { status: "VOIDED" } })
    );
    expect(depositUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "VOIDED" }) })
    );
  });

  it("rechaza si el depósito ya está anulado", async () => {
    const { txCreate } = installVoidTx(
      [depositTxRow("tx-1", "DEP-000002")],
      [{ id: "dep-1", companyId: COMPANY_ID, status: "VOIDED", transactionId: "tx-1" }],
    );
    await expect(voidDep("dep-1")).rejects.toThrow(/ya está anulado/i);
    expect(txCreate).not.toHaveBeenCalled();
  });
});

describe("voidDeposit — correlativo DEP-REV- (MÁXIMO + 1, no count de depósitos)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin reversiones previas → DEP-REV-000001", async () => {
    // Sólo existe el asiento del depósito (serie DEP-). El máximo de DEP-REV- es
    // inexistente → la serie arranca en 1.
    const { txCreate } = installVoidTx([depositTxRow("tx-1", "DEP-000002")]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000001"]);
  });

  it("REGRESIÓN (bug del count): con 2 depósitos y una reversión previa DEP-REV-000003, anular otro depósito da DEP-REV-000004, no DEP-REV-000003", async () => {
    // Estado exacto que reventaba en producción, SIN NINGUNA CARRERA:
    //   2 depósitos → 2 filas en cajaCajaDeposit
    //   anular A → count = 2 → DEP-REV-000003
    //   anular B → count = 2 → DEP-REV-000003   ← duplicado → P2002
    // `count` cuenta FILAS y anular NO crea ni borra filas de depósito: sólo pone
    // status VOIDED. El conteo es el MISMO en todas las anulaciones.
    //
    // (Los asientos de depósito van DEP-000002/DEP-000003 y no 000001/000002 porque
    // createDeposit cuenta DESPUÉS de crear la fila — off-by-one real de esa serie,
    // ajeno a este fix.)
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"), // asiento del depósito que se anula ahora
      depositTxRow("tx-2", "DEP-000003"), // asiento del otro depósito
      revTxRow("DEP-REV-000003"), // la anulación anterior, numerada por el count roto
    ]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000004"]);
  });

  it("dos anulaciones SERIALES (cero concurrencia) → DEP-REV-000001 y DEP-REV-000002, nunca el mismo número", async () => {
    // Reproducción end-to-end del bug: con el count de depósitos ambas anulaciones
    // proponían DEP-REV-000003 y la segunda reventaba con P2002 sobre
    // Transaction.number (@@unique([companyId, number])).
    const { txCreate } = installVoidTx(
      [depositTxRow("tx-1", "DEP-000002"), depositTxRow("tx-2", "DEP-000003")],
      [
        { id: "dep-1", companyId: COMPANY_ID, status: "POSTED", transactionId: "tx-1" },
        { id: "dep-2", companyId: COMPANY_ID, status: "POSTED", transactionId: "tx-2" },
      ],
    );

    await voidDep("dep-1");
    await voidDep("dep-2");

    const numbers = numbersCreated(txCreate);
    expect(numbers).toEqual(["DEP-REV-000001", "DEP-REV-000002"]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("último = DEP-REV-000009 → DEP-REV-000010 (el relleno de ceros no se rompe)", async () => {
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
      revTxRow("DEP-REV-000009"),
    ]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000010"]);
  });

  it("toma el MÁXIMO, no la primera fila que devuelve la tabla", async () => {
    // Las filas llegan desordenadas a propósito: si el lookup pierde el
    // `orderBy: { number: "desc" }`, el motor no promete ningún orden y el máximo
    // deja de ser el que se lee. Sin desc esto daría DEP-REV-000002.
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
      revTxRow("DEP-REV-000001"),
      revTxRow("DEP-REV-000009"),
      revTxRow("DEP-REV-000004"),
    ]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000010"]);
  });

  it("la serie de depósitos (DEP-000005) y la de depreciación (DEP-2026...) no contaminan el máximo de reversiones", async () => {
    // El prefijo se filtra COMPLETO (`DEP-REV-`) a propósito: `DEP-` a secas casa
    // también con la serie de depósitos y con la de FixedAssetDepreciationService,
    // y como "DEP-REV-…" > "DEP-0…"/"DEP-2…" en orden lexicográfico, el máximo
    // saldría de la serie equivocada.
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
      revTxRow("DEP-REV-000002"),
      depositTxRow("tx-9", "DEP-000005"),
      depreciationTxRow("DEP-202606-A1B2C3D4"),
    ]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000003"]);
  });

  it("ADR-004: ignora las reversiones de OTRA empresa", async () => {
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
      revTxRow("DEP-REV-000002"),
      revTxRow("DEP-REV-000009", "comp-2"), // otro tenant, más alto: no debe verse
    ]);

    await voidDep("dep-1");

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000003"]);
  });

  it("un number con sufijo no numérico no lanza: cae a DEP-REV-000001", async () => {
    // Fila manual/importada. `parseInt` da NaN y `Number.isFinite` lo atrapa; sin
    // ese guard el correlativo saldría "DEP-REV-NaN" o reventaría el padStart.
    const { txCreate } = installVoidTx([
      depositTxRow("tx-1", "DEP-000002"),
      revTxRow("DEP-REV-MANUAL"),
    ]);

    await expect(voidDep("dep-1")).resolves.toBeUndefined();

    expect(numbersCreated(txCreate)).toEqual(["DEP-REV-000001"]);
  });

  it("query shape: el lookup filtra por el prefijo COMPLETO, por empresa y ordena desc", async () => {
    // Contrato de la consulta, no sólo del resultado: los tres elementos son los
    // que hacen que el MÁXIMO sea el máximo de la serie correcta.
    const { txFindFirst } = installVoidTx([depositTxRow("tx-1", "DEP-000002")]);

    await voidDep("dep-1");

    const correlativeCall = txFindFirst.mock.calls
      .map((c) => c[0] as TxFindFirstArgs)
      .find((args) => args?.where?.number !== undefined);
    expect(correlativeCall).toBeDefined();
    expect(correlativeCall!.where!.number!.startsWith).toBe("DEP-REV-");
    expect(correlativeCall!.where!.companyId).toBe(COMPANY_ID);
    expect(correlativeCall!.orderBy).toEqual({ number: "desc" });
  });
});
