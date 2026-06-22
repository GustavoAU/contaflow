import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { createMovement } from "../services/CajaCajaMovementService";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const CAJA_ACCOUNT = "acc-caja";
const EXPENSE_ACCOUNT = "acc-expense";

// createMovement usa assertDateInOpenPeriod con la fecha del input ("2026-06-13");
// el período mockeado debe coincidir en año/mes (junio 2026) — HC-02.
type TxOverrides = Record<string, unknown>;

function makeTx(overrides: TxOverrides = {}, createOverrides: Record<string, unknown> = {}) {
  const movementCreate = vi.fn().mockResolvedValue({
    id: "mov-1",
    cajaCajaId: "caja-1",
    date: new Date("2026-06-13"),
    voucherNumber: "CCC-2026-00001",
    concept: "Café",
    description: null,
    expenseAccountId: EXPENSE_ACCOUNT,
    expenseAccount: { code: "5101", name: "Gastos varios" },
    amount: new Decimal("150000"),
    currency: "VES",
    status: "PENDING",
    providerRif: null,
    approvedAt: null,
    approvedBy: null,
    reimbursementId: null,
    createdAt: new Date(),
    voidedAt: null,
    ...createOverrides,
  });
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
    cajaCajaMovement: { count: vi.fn().mockResolvedValue(0), create: movementCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, movementCreate };
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
