import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn() },
}));

// withSerializableRetry avisa a Sentry en el penúltimo intento (tx-helpers.ts:31).
// Sin este mock, los tests de retry despertarían el SDK real.
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import prisma from "@/lib/prisma";
import { SERIALIZABLE_TX_OPTIONS } from "@/lib/tx-helpers";
import { createMovement } from "../services/CajaCajaMovementService";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const CAJA_ACCOUNT = "acc-caja";
const EXPENSE_ACCOUNT = "acc-expense";

// createMovement usa assertDateInOpenPeriod con la fecha del input ("2026-06-13");
// el período mockeado debe coincidir en año/mes (junio 2026) — HC-02.
type TxOverrides = Record<string, unknown>;

/**
 * Semillas de la tabla falsa de `CajaCajaMovement`:
 * - `existingMovements`: filas de la empresa que ya existen cuando arranca la tx.
 * - `otherCompanyMovements`: filas de OTRO tenant, que el `count` no debe ver (ADR-004).
 */
type MakeTxOptions = { existingMovements?: number; otherCompanyMovements?: number };

type FakeMovementRow = { id: string; companyId: string };

function makeTx(
  overrides: TxOverrides = {},
  createOverrides: Record<string, unknown> = {},
  options: MakeTxOptions = {},
) {
  // Tabla falsa de CajaCajaMovement: `count` refleja las filas realmente existentes.
  // getNextVoucherNumber deriva el correlativo de ese conteo, así que un
  // `mockResolvedValue(0)` fijo devuelve lo mismo con la fórmula correcta y con una
  // rota — el correlativo quedaría sin observar (mismo agujero que dejó vivir el bug
  // del count en voidDeposit y en IncomeDistribution).
  const movementRows: FakeMovementRow[] = [
    ...Array.from({ length: options.existingMovements ?? 0 }, (_, i) => ({
      id: `mov-prev-${i + 1}`,
      companyId: COMPANY_ID,
    })),
    ...Array.from({ length: options.otherCompanyMovements ?? 0 }, (_, i) => ({
      id: `mov-otra-empresa-${i + 1}`,
      companyId: "comp-2",
    })),
  ];

  let created = 0;
  const movementCreate = vi.fn().mockImplementation(
    async (args: {
      data: {
        companyId: string;
        date: Date;
        voucherNumber: string;
        concept: string;
        description?: string | null;
        expenseAccountId: string;
        amount: Decimal;
        currency: string;
        status: string;
        providerRif?: string | null;
        supportingDocumentId?: string | null;
      };
    }) => {
      created += 1;
      movementRows.push({ id: `mov-${created}`, companyId: args.data.companyId });
      // La BD devuelve lo que se ESCRIBIÓ. Devolver constantes propias del test hace
      // que el summary lleve valores que producción nunca produjo — así es como el
      // `voucherNumber` de este archivo se venía afirmando contra el mock, no contra
      // el código (el valor salía del literal de la línea 25, no de
      // getNextVoucherNumber).
      return {
        id: "mov-1",
        cajaCajaId: "caja-1",
        date: args.data.date,
        voucherNumber: args.data.voucherNumber,
        concept: args.data.concept,
        description: args.data.description ?? null,
        expenseAccountId: args.data.expenseAccountId,
        expenseAccount: { code: "5101", name: "Gastos varios" },
        amount: args.data.amount,
        currency: args.data.currency,
        status: args.data.status,
        providerRif: args.data.providerRif ?? null,
        supportingDocumentId: args.data.supportingDocumentId ?? null,
        approvedAt: null,
        approvedBy: null,
        reimbursementId: null,
        createdAt: new Date("2026-06-13T10:00:00.000Z"),
        voidedAt: null,
        ...createOverrides,
      };
    },
  );

  const movementCount = vi.fn().mockImplementation(
    async (args?: { where?: { companyId?: string } }) =>
      movementRows.filter(
        (r) => args?.where?.companyId === undefined || r.companyId === args.where.companyId,
      ).length,
  );

  const auditCreate = vi.fn().mockResolvedValue({});

  const tx = {
    cajaCaja: {
      findFirst: vi.fn().mockResolvedValue({
        id: "caja-1",
        companyId: COMPANY_ID,
        accountId: CAJA_ACCOUNT,
        status: "ACTIVE",
        deposits: [{ amount: new Decimal("1000000") }],
        movements: [],
      }),
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: "period-1", year: 2026, month: 6, status: "OPEN" }),
    },
    // assertAccountOfType (guard) + segunda consulta para code/name. Ambas usan
    // account.findFirst; por defecto devuelve una cuenta EXPENSE válida con code/name.
    account: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: EXPENSE_ACCOUNT, type: "EXPENSE", code: "5101", name: "Gastos varios" }),
    },
    cajaCajaMovement: { count: movementCount, create: movementCreate },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, movementCreate, movementCount, auditCreate, movementRows };
}

// HC-01 (ADR-037): supportingDocumentId SIEMPRE obligatorio.
// HC-10 (ADR-037): providerRif opcional (la clave está presente con valor undefined
// porque el Zod usa .transform → el input type es `string | undefined`).
const baseInput = {
  companyId: COMPANY_ID,
  cajaCajaId: "caja-1",
  date: "2026-06-13",
  concept: "Café",
  expenseAccountId: EXPENSE_ACCOUNT,
  amount: "150000",
  currency: "VES" as const,
  supportingDocumentId: "FAC-001",
  providerRif: undefined,
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades compartidas — aislamiento, concurrencia y lectura del correlativo
// ─────────────────────────────────────────────────────────────────────────────

type CapturedTxOptions = { isolationLevel?: string; timeout?: number; maxWait?: number };

/**
 * Opciones con las que el CÓDIGO abrió la transacción: 2º argumento de
 * `prisma.$transaction`. El mock lo ignora al ejecutar, pero el spy lo registra —
 * y es lo ÚNICO que distingue `$transaction(fn)` (Read Committed, sin predicate
 * locking) de `$transaction(fn, { isolationLevel: "Serializable" })`.
 */
function txOptionsOf(callIndex = 0): CapturedTxOptions | undefined {
  const call = vi.mocked(prisma.$transaction).mock.calls[callIndex] as unknown[] | undefined;
  return call?.[1] as CapturedTxOptions | undefined;
}

/** Error de serialización de Postgres tal y como lo mapea Prisma. */
function p2034() {
  return Object.assign(new Error("could not serialize access due to read/write dependencies"), {
    code: "P2034",
  });
}

/** Copia superficial de una tabla falsa, para emular el ROLLBACK de un intento abortado. */
function snapshotRows<T extends object>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

/** Restaura la tabla falsa al estado del snapshot (deshace lo escrito por el intento). */
function restoreRows<T extends object>(rows: T[], snapshot: T[]): void {
  rows.length = 0;
  rows.push(...snapshot.map((r) => ({ ...r })));
}

/**
 * Los `voucherNumber` con los que el CÓDIGO llamó a `cajaCajaMovement.create` —
 * leídos del ARGUMENTO, que es donde getNextVoucherNumber los produce. Leerlos del
 * valor devuelto por el mock es afirmar el literal del propio test.
 */
function vouchersCreated(create: { mock: { calls: unknown[][] } }): string[] {
  return create.mock.calls.map(
    (call) => (call[0] as { data: { voucherNumber: string } }).data.voucherNumber,
  );
}

describe("createMovement — guard de tipo de cuenta (HC-09 / ADR-036 D-3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: crea movimiento PENDING con cuenta EXPENSE", async () => {
    const { movementCreate } = makeTx();
    const result = await createMovement(baseInput, USER_ID);
    expect(result.id).toBe("mov-1");
    expect(result.status).toBe("PENDING");
    expect(movementCreate).toHaveBeenCalledTimes(1);
  });

  it("rechaza si expenseAccountId NO es de tipo EXPENSE (es ASSET)", async () => {
    const movementCreate = vi.fn();
    makeTx({
      account: {
        findFirst: vi.fn().mockResolvedValue({ id: EXPENSE_ACCOUNT, type: "ASSET", code: "1010", name: "Caja" }),
      },
      cajaCajaMovement: { count: vi.fn().mockResolvedValue(0), create: movementCreate },
    });
    await expect(createMovement(baseInput, USER_ID)).rejects.toThrow(/Gasto/i);
    expect(movementCreate).not.toHaveBeenCalled();
  });
});

describe("createMovement — persistencia de providerRif (HC-10 / ADR-037)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persiste providerRif en create.data cuando viene", async () => {
    const { movementCreate } = makeTx({}, { providerRif: "J-12345678-9" });
    const result = await createMovement(
      { ...baseInput, providerRif: "J-12345678-9" },
      USER_ID
    );
    expect(movementCreate).toHaveBeenCalledTimes(1);
    expect(movementCreate.mock.calls[0][0].data).toMatchObject({
      providerRif: "J-12345678-9",
    });
    // serializeMovement expone providerRif desde el registro persistido.
    expect(result.providerRif).toBe("J-12345678-9");
  });

  it("persiste providerRif undefined cuando no viene (gasto menudo)", async () => {
    const { movementCreate } = makeTx();
    const result = await createMovement(baseInput, USER_ID);
    expect(movementCreate.mock.calls[0][0].data.providerRif).toBeUndefined();
    // serializeMovement normaliza null → providerRif: null en el summary.
    expect(result.providerRif).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createMovement — Z-1: el nivel de aislamiento es contrato, no detalle
// ─────────────────────────────────────────────────────────────────────────────

describe("createMovement — Z-1: aislamiento Serializable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre la transacción con isolationLevel Serializable (no Read Committed)", async () => {
    // Z-1 de CLAUDE.md: todo correlativo va en Serializable SIN EXCEPCIÓN. Aquí el
    // voucher `CCC-` sale de un `count`; bajo Read Committed dos movimientos
    // concurrentes leen el mismo conteo, proponen el mismo voucher y el segundo
    // revienta con P2002 contra @@unique([companyId, voucherNumber]).
    makeTx();

    await createMovement(baseInput, USER_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txOptionsOf()?.isolationLevel).toBe("Serializable");
  });

  it("M2: lleva timeout y maxWait explícitos — los 5 s por defecto no cubren el cold start de Neon", async () => {
    makeTx();

    await createMovement(baseInput, USER_ID);

    expect(txOptionsOf()).toEqual(SERIALIZABLE_TX_OPTIONS);
    expect(txOptionsOf()!.timeout!).toBeGreaterThan(5000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createMovement — correlativo CCC- (leído donde el código lo PRODUCE)
// ─────────────────────────────────────────────────────────────────────────────

describe("createMovement — correlativo CCC- (getNextVoucherNumber)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sólo Date: el año del voucher sale de `new Date().getFullYear()` y sin congelar
    // el reloj este archivo cambiaría de expectativa el 1 de enero. `setTimeout` queda
    // REAL a propósito — los reintentos P2034 duermen de verdad.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("primer movimiento de la empresa → CCC-2026-00001, leído de create.data (no del mock)", async () => {
    // Contraste deliberado con la serie DEP- de los depósitos: aquí el `count` corre
    // ANTES del `create` (getNextVoucherNumber, línea 140 vs 142), así que la serie sí
    // arranca en 00001 y no tiene el off-by-one de aquélla.
    const { movementCreate } = makeTx();

    await createMovement(baseInput, USER_ID);

    expect(vouchersCreated(movementCreate)).toEqual(["CCC-2026-00001"]);
  });

  it("el voucher del summary es el que se PERSISTIÓ, no un literal del test", async () => {
    const { movementCreate } = makeTx();

    const result = await createMovement(baseInput, USER_ID);

    expect(result.voucherNumber).toBe(vouchersCreated(movementCreate)[0]);
    expect(result.voucherNumber).toBe("CCC-2026-00001");
  });

  it("dos movimientos seriales → CCC-2026-00001 y CCC-2026-00002, nunca el mismo", async () => {
    // Sin carrera ninguna: si el `count` no viera la fila anterior, ambos saldrían con
    // el mismo voucher y el segundo reventaría con P2002 sobre
    // @@unique([companyId, voucherNumber]).
    const { movementCreate } = makeTx();

    await createMovement(baseInput, USER_ID);
    await createMovement(baseInput, USER_ID);

    const vouchers = vouchersCreated(movementCreate);
    expect(vouchers).toEqual(["CCC-2026-00001", "CCC-2026-00002"]);
    expect(new Set(vouchers).size).toBe(vouchers.length);
  });

  it("con 9 movimientos previos → CCC-2026-00010 (el relleno a 5 dígitos no se rompe)", async () => {
    const { movementCreate } = makeTx({}, {}, { existingMovements: 9 });

    await createMovement(baseInput, USER_ID);

    expect(vouchersCreated(movementCreate)).toEqual(["CCC-2026-00010"]);
  });

  it("ADR-004: los movimientos de otra empresa no mueven el correlativo", async () => {
    const { movementCreate, movementCount } = makeTx({}, {}, { otherCompanyMovements: 4 });

    await createMovement(baseInput, USER_ID);

    // El conteo se pide filtrado por empresa; sin el filtro este caso daría
    // CCC-2026-00005 y el correlativo de un tenant lo movería otro.
    expect(movementCount.mock.calls[0][0]).toEqual({ where: { companyId: COMPANY_ID } });
    expect(vouchersCreated(movementCreate)).toEqual(["CCC-2026-00001"]);
  });

  it("R-6: la auditoría registra el MISMO voucher que se persistió", async () => {
    const { movementCreate, auditCreate } = makeTx({}, {}, { existingMovements: 2 });

    await createMovement(baseInput, USER_ID);

    const audited = (auditCreate.mock.calls[0][0] as {
      data: { newValue: { voucherNumber: string } };
    }).data.newValue.voucherNumber;
    expect(audited).toBe("CCC-2026-00003");
    expect(audited).toBe(vouchersCreated(movementCreate)[0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createMovement — reintento P2034 (lo que hace SEGURO el correlativo)
// ─────────────────────────────────────────────────────────────────────────────

describe("createMovement — reintento P2034 (Serializable)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] }); // setTimeout REAL: el backoff del retry duerme de verdad
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("tras el abort de SSI RECALCULA el voucher: CCC-2026-00002, no reusa el 00001 de la pasada abortada", async () => {
    // Serializable no evita el conflicto: lo DETECTA. La rival inserta una fila dentro
    // del predicado que aquí se cuenta, SSI aborta con P2034 y el helper reintenta.
    // El valor del retry está en que el segundo intento vuelva a CONTAR: si reusara el
    // voucher calculado en la primera pasada, el duplicado volvería intacto.
    const { tx, movementCreate, movementRows } = makeTx();

    let attempt = 0;
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => {
      attempt += 1;
      if (attempt === 1) {
        const snapshot = snapshotRows(movementRows);
        await fn(tx); // propone CCC-2026-00001…
        // …y aborta: ROLLBACK de su propia fila + la fila que la rival SÍ commiteó.
        restoreRows(movementRows, snapshot);
        movementRows.push({ id: "mov-rival", companyId: COMPANY_ID });
        throw p2034();
      }
      return fn(tx);
    }) as never);

    const result = await createMovement(baseInput, USER_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(vouchersCreated(movementCreate)).toEqual(["CCC-2026-00001", "CCC-2026-00002"]);
    // El que queda commiteado es el recalculado, y es el que ve el usuario.
    expect(result.voucherNumber).toBe("CCC-2026-00002");
    // Ambos intentos van en Serializable — el retry no degrada el aislamiento.
    expect(txOptionsOf(0)?.isolationLevel).toBe("Serializable");
    expect(txOptionsOf(1)?.isolationLevel).toBe("Serializable");
  });

  it("agotados los 3 intentos el P2034 sale hacia arriba (no se traga el conflicto)", async () => {
    makeTx();
    vi.mocked(prisma.$transaction).mockRejectedValue(p2034());

    await expect(createMovement(baseInput, USER_ID)).rejects.toMatchObject({ code: "P2034" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("un error que NO es P2034 propaga en el primer intento, sin reintentos", async () => {
    // Reintentar un error de negocio (saldo insuficiente) sólo multiplicaría el trabajo.
    makeTx({
      cajaCaja: {
        findFirst: vi.fn().mockResolvedValue({
          id: "caja-1",
          companyId: COMPANY_ID,
          accountId: CAJA_ACCOUNT,
          status: "ACTIVE",
          deposits: [{ amount: new Decimal("100") }],
          movements: [],
        }),
      },
    });

    await expect(createMovement(baseInput, USER_ID)).rejects.toThrow(/Saldo insuficiente/i);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
