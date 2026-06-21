import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn() },
}));

import prisma from "@/lib/prisma";
import {
  createReimbursement,
  postReimbursement,
  voidReimbursement,
} from "../services/CajaCajaReimbursementService";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const CAJA_ID = "caja-1";
const CAJA_ACCOUNT = "acc-caja";
const ACC_A = "acc-A";
const ACC_B = "acc-B";
const MONTH = "2026-06";

type TxOverrides = Record<string, unknown>;

/**
 * Construye un tx mock con valores por defecto sanos para createReimbursement,
 * sobreescribibles por bloque. El service usa $transaction con 2º arg
 * { isolationLevel: "Serializable" } — el mock ignora el 2º arg y solo invoca fn(tx).
 */
function makeCreateTx(overrides: TxOverrides = {}) {
  const reimbCreate = vi.fn().mockResolvedValue({
    id: "reimb-1",
    cajaCajaId: CAJA_ID,
    monthYear: MONTH,
    reimbursementNumber: "REIMB-2026-00001",
    totalExpensesVes: new Decimal("350"),
    status: "DRAFT",
    transactionId: null,
    postedAt: null,
    postedBy: null,
    createdAt: new Date("2026-06-21"),
    voidedAt: null,
    movements: [],
  });
  const movUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
  const auditCreate = vi.fn().mockResolvedValue({});

  const tx = {
    cajaCaja: {
      findFirst: vi.fn().mockResolvedValue({
        id: CAJA_ID,
        companyId: COMPANY_ID,
        accountId: CAJA_ACCOUNT,
        status: "ACTIVE",
      }),
    },
    cajaCajaReimbursement: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: reimbCreate,
      update: vi.fn(),
    },
    cajaCajaMovement: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "mov-1",
          amount: new Decimal("100"),
          expenseAccountId: ACC_A,
          expenseAccount: { id: ACC_A, code: "6.1", name: "Papelería" },
        },
        {
          id: "mov-2",
          amount: new Decimal("50"),
          expenseAccountId: ACC_A,
          expenseAccount: { id: ACC_A, code: "6.1", name: "Papelería" },
        },
        {
          id: "mov-3",
          amount: new Decimal("200"),
          expenseAccountId: ACC_B,
          expenseAccount: { id: ACC_B, code: "6.2", name: "Transporte" },
        },
      ]),
      updateMany: movUpdateMany,
    },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, reimbCreate, movUpdateMany, auditCreate };
}

const createInput = {
  companyId: COMPANY_ID,
  cajaCajaId: CAJA_ID,
  monthYear: MONTH,
};

// ─────────────────────────────────────────────────────────────────────────────
// createReimbursement
// ─────────────────────────────────────────────────────────────────────────────
describe("createReimbursement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: crea reembolso DRAFT, totaliza con Decimal y vincula movimientos", async () => {
    const { reimbCreate, movUpdateMany, auditCreate } = makeCreateTx();

    const result = await createReimbursement(createInput, USER_ID);

    // total = 100 + 50 + 200 = 350 (verificado con Decimal vía el create)
    expect(reimbCreate).toHaveBeenCalledTimes(1);
    const createData = reimbCreate.mock.calls[0][0].data;
    expect(createData.status).toBe("DRAFT");
    expect((createData.totalExpensesVes as Decimal).toString()).toBe("350");
    expect(createData.companyId).toBe(COMPANY_ID);
    expect(createData.cajaCajaId).toBe(CAJA_ID);
    expect(createData.monthYear).toBe(MONTH);

    // vincula los 3 movimientos al reembolso
    expect(movUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["mov-1", "mov-2", "mov-3"] } },
        data: { reimbursementId: "reimb-1" },
      })
    );

    // AuditLog R-6
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_REIMBURSEMENT",
          entityName: "CajaCajaReimbursement",
          entityId: "reimb-1",
        }),
      })
    );

    // salida serializada con total a 2 decimales
    expect(result.totalExpensesVes).toBe("350.00");
    expect(result.status).toBe("DRAFT");
  });

  it("rechaza si la caja no existe", async () => {
    makeCreateTx({ cajaCaja: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(createReimbursement(createInput, USER_ID)).rejects.toThrow(
      /no encontrada/i
    );
  });

  it("rechaza si la caja no está ACTIVE", async () => {
    makeCreateTx({
      cajaCaja: {
        findFirst: vi.fn().mockResolvedValue({
          id: CAJA_ID,
          companyId: COMPANY_ID,
          accountId: CAJA_ACCOUNT,
          status: "CLOSED",
        }),
      },
    });
    await expect(createReimbursement(createInput, USER_ID)).rejects.toThrow(
      /no está activa/i
    );
  });

  it("rechaza si ya existe un reembolso no-VOIDED para el mes", async () => {
    makeCreateTx({
      cajaCajaReimbursement: {
        findFirst: vi.fn().mockResolvedValue({ id: "reimb-old", status: "DRAFT" }),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    await expect(createReimbursement(createInput, USER_ID)).rejects.toThrow(
      /Ya existe un reembolso/i
    );
  });

  it("rechaza si no hay gastos aprobados en el período", async () => {
    makeCreateTx({
      cajaCajaMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
    });
    await expect(createReimbursement(createInput, USER_ID)).rejects.toThrow(
      /No hay gastos aprobados/i
    );
  });

  it("permite recrear el reembolso de un mes cuyo previo está VOIDED — el check excluye VOIDED (ADR-035)", async () => {
    // El índice único es PARCIAL (WHERE status<>VOIDED); el service alinea su
    // check de duplicado consultando solo reembolsos vigentes. Un previo anulado
    // no debe bloquear la recreación. Aquí findFirst (mock por defecto) → null.
    const { tx, reimbCreate } = makeCreateTx();

    const result = await createReimbursement(createInput, USER_ID);

    // el check de duplicado EXCLUYE explícitamente los VOIDED
    expect(
      (tx.cajaCajaReimbursement as { findFirst: ReturnType<typeof vi.fn> }).findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "VOIDED" } }),
      }),
    );
    // y crea el nuevo reembolso normalmente
    expect(reimbCreate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("DRAFT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// postReimbursement  ← asiento al Mayor (partida doble)
// ─────────────────────────────────────────────────────────────────────────────
function makePostTx(overrides: TxOverrides = {}) {
  const txCreate = vi.fn().mockResolvedValue({ id: "tx-1" });
  const movUpdateMany = vi.fn().mockResolvedValue({ count: 3 });
  const reimbUpdate = vi.fn().mockResolvedValue({
    id: "reimb-1",
    cajaCajaId: CAJA_ID,
    monthYear: MONTH,
    reimbursementNumber: "REIMB-2026-00001",
    totalExpensesVes: new Decimal("350"),
    status: "POSTED",
    transactionId: "tx-1",
    postedAt: new Date("2026-06-21"),
    postedBy: USER_ID,
    createdAt: new Date("2026-06-21"),
    voidedAt: null,
    movements: [],
  });
  const auditCreate = vi.fn().mockResolvedValue({});

  const tx = {
    cajaCajaReimbursement: {
      findFirst: vi.fn().mockResolvedValue({
        id: "reimb-1",
        status: "DRAFT",
        reimbursementNumber: "REIMB-2026-00001",
        totalExpensesVes: new Decimal("350"),
        monthYear: MONTH,
        cajaCaja: { accountId: CAJA_ACCOUNT },
        movements: [
          { expenseAccountId: ACC_A, amount: new Decimal("100"), expenseAccount: { id: ACC_A } },
          { expenseAccountId: ACC_A, amount: new Decimal("50"), expenseAccount: { id: ACC_A } },
          { expenseAccountId: ACC_B, amount: new Decimal("200"), expenseAccount: { id: ACC_B } },
        ],
      }),
      update: reimbUpdate,
    },
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "OPEN" }),
    },
    transaction: { create: txCreate },
    cajaCajaMovement: { updateMany: movUpdateMany },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, txCreate, movUpdateMany, reimbUpdate, auditCreate };
}

const postInput = { reimbursementId: "reimb-1", companyId: COMPANY_ID };

describe("postReimbursement — asiento al Mayor (partida doble N4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: debita gastos agrupados, acredita caja, Σ=0, marca REIMBURSED y POSTED", async () => {
    const { txCreate, movUpdateMany, reimbUpdate, auditCreate } = makePostTx();

    await postReimbursement(postInput, USER_ID);

    expect(txCreate).toHaveBeenCalledTimes(1);
    const txData = txCreate.mock.calls[0][0].data;
    const entries = txData.entries.create as Array<{
      accountId: string;
      amount: Decimal;
    }>;

    // 2 cuentas de gasto agrupadas + 1 cuenta de caja = 3 entries
    expect(entries).toHaveLength(3);

    const drA = entries.find((e) => e.accountId === ACC_A)!;
    const drB = entries.find((e) => e.accountId === ACC_B)!;
    const crCaja = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;

    // gastos AGRUPADOS y positivos: A = 100+50 = 150, B = 200
    expect(drA.amount.toString()).toBe("150");
    expect(drB.amount.toString()).toBe("200");

    // caja acreditada por el total negado
    expect(crCaja.amount.toString()).toBe("-350");

    // partida doble balanceada (Decimal)
    const sum = entries.reduce((a, e) => a.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);

    // período OPEN usado
    expect(txData.periodId).toBe("period-1");

    // movimientos marcados REIMBURSED
    expect(movUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reimbursementId: "reimb-1" },
        data: { status: "REIMBURSED" },
      })
    );

    // reembolso → POSTED con transactionId
    expect(reimbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reimb-1" },
        data: expect.objectContaining({
          status: "POSTED",
          transactionId: "tx-1",
          postedBy: USER_ID,
        }),
      })
    );

    // AuditLog R-6
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "POST_REIMBURSEMENT",
          entityId: "reimb-1",
        }),
      })
    );
  });

  it("rechaza si el reembolso no existe", async () => {
    makePostTx({
      cajaCajaReimbursement: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    await expect(postReimbursement(postInput, USER_ID)).rejects.toThrow(
      /no encontrado/i
    );
  });

  it("rechaza si el reembolso no está en DRAFT", async () => {
    makePostTx({
      cajaCajaReimbursement: {
        findFirst: vi.fn().mockResolvedValue({
          id: "reimb-1",
          status: "POSTED",
          reimbursementNumber: "REIMB-2026-00001",
          totalExpensesVes: new Decimal("350"),
          monthYear: MONTH,
          cajaCaja: { accountId: CAJA_ACCOUNT },
          movements: [],
        }),
        update: vi.fn(),
      },
    });
    await expect(postReimbursement(postInput, USER_ID)).rejects.toThrow(/borrador/i);
  });

  it("rechaza si no hay período contable abierto", async () => {
    makePostTx({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(postReimbursement(postInput, USER_ID)).rejects.toThrow(/período/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// voidReimbursement
// ─────────────────────────────────────────────────────────────────────────────
function makeVoidTx(overrides: TxOverrides = {}) {
  const movUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
  const reimbUpdate = vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});

  const tx = {
    cajaCajaReimbursement: {
      findFirst: vi.fn().mockResolvedValue({
        id: "reimb-1",
        status: "DRAFT",
      }),
      update: reimbUpdate,
    },
    cajaCajaMovement: { updateMany: movUpdateMany },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, movUpdateMany, reimbUpdate, auditCreate };
}

const voidInput = {
  reimbursementId: "reimb-1",
  companyId: COMPANY_ID,
  voidReason: "Cargado por error",
};

describe("voidReimbursement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path DRAFT: resetea movimientos, marca VOIDED y crea AuditLog", async () => {
    const { movUpdateMany, reimbUpdate, auditCreate } = makeVoidTx();

    await voidReimbursement(voidInput, USER_ID);

    // movimientos desvinculados (reimbursementId: null)
    expect(movUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reimbursementId: "reimb-1" },
        data: { reimbursementId: null },
      })
    );

    // reembolso → VOIDED
    expect(reimbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reimb-1" },
        data: expect.objectContaining({
          status: "VOIDED",
          voidReason: "Cargado por error",
        }),
      })
    );

    // AuditLog R-6
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "VOID_REIMBURSEMENT",
          entityId: "reimb-1",
        }),
      })
    );
  });

  it("rechaza si ya está VOIDED", async () => {
    makeVoidTx({
      cajaCajaReimbursement: {
        findFirst: vi.fn().mockResolvedValue({ id: "reimb-1", status: "VOIDED" }),
        update: vi.fn(),
      },
    });
    await expect(voidReimbursement(voidInput, USER_ID)).rejects.toThrow(
      /ya está anulado/i
    );
  });

  it("rechaza si está POSTED (publicados no se anulan directamente)", async () => {
    makeVoidTx({
      cajaCajaReimbursement: {
        findFirst: vi.fn().mockResolvedValue({ id: "reimb-1", status: "POSTED" }),
        update: vi.fn(),
      },
    });
    await expect(voidReimbursement(voidInput, USER_ID)).rejects.toThrow(
      /publicados no se pueden anular/i
    );
  });
});
