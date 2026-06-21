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
  const tx = {
    cajaCaja: {
      findFirst: vi.fn().mockResolvedValue({
        id: "caja-1", companyId: COMPANY_ID, accountId: CAJA_ACCOUNT, status: "ACTIVE",
      }),
    },
    account: {
      findFirst: vi.fn().mockResolvedValue({ id: SOURCE_ACCOUNT }),
    },
    accountingPeriod: {
      // year/month deben coincidir con baseInput.date ("2026-06-13") — HC-02
      findFirst: vi.fn().mockResolvedValue({ id: "period-1", year: 2026, month: 6, status: "OPEN" }),
    },
    cajaCajaDeposit: {
      create: vi.fn().mockResolvedValue({
        id: "dep-1", cajaCajaId: "caja-1", date: new Date("2026-06-13"),
        amount: new Decimal("500000"), description: "Reposición", status: "POSTED",
        transactionId: null, createdAt: new Date(), voidedAt: null, voidReason: null,
      }),
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
  return { tx, txCreate, depositUpdate, txUpdate };
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
    await expect(createDeposit(baseInput, USER_ID)).rejects.toThrow(/no encontrada/i);
  });

  it("rechaza si la cuenta origen es la misma cuenta de la caja", async () => {
    makeTx({ account: { findFirst: vi.fn().mockResolvedValue({ id: CAJA_ACCOUNT }) } });
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

describe("voidDeposit — reversión GL (VOID nunca borra)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea contrapartida espejo balanceada y marca original VOIDED", async () => {
    const original = {
      id: "tx-1", status: "POSTED",
      entries: [
        { accountId: CAJA_ACCOUNT, amount: new Decimal("500000"), description: "Depósito Caja Chica — Reposición" },
        { accountId: SOURCE_ACCOUNT, amount: new Decimal("-500000"), description: "Salida fondos hacia Caja Chica — Reposición" },
      ],
    };
    const txCreate = vi.fn().mockResolvedValue({ id: "tx-rev" });
    const txUpdate = vi.fn().mockResolvedValue({});
    const depositUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      cajaCajaDeposit: {
        findFirst: vi.fn().mockResolvedValue({ id: "dep-1", status: "POSTED", transactionId: "tx-1" }),
        count: vi.fn().mockResolvedValue(1),
        update: depositUpdate,
      },
      transaction: {
        findFirst: vi.fn().mockResolvedValue(original),
        create: txCreate,
        update: txUpdate,
      },
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "OPEN" }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: unknown) => unknown) => fn(tx)) as never
    );

    await voidDeposit({ depositId: "dep-1", companyId: COMPANY_ID, voidReason: "Duplicado" }, USER_ID);

    // Reversión balanceada con montos invertidos
    const revEntries = txCreate.mock.calls[0][0].data.entries.create as Array<{
      accountId: string; amount: Decimal;
    }>;
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
    const tx = {
      cajaCajaDeposit: {
        findFirst: vi.fn().mockResolvedValue({ id: "dep-1", status: "VOIDED", transactionId: "tx-1" }),
        update: vi.fn(),
      },
      transaction: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      accountingPeriod: { findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (t: unknown) => unknown) => fn(tx)) as never
    );
    await expect(
      voidDeposit({ depositId: "dep-1", companyId: COMPANY_ID, voidReason: "x" }, USER_ID)
    ).rejects.toThrow(/ya está anulado/i);
  });
});
