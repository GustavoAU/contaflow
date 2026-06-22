import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    cajaCaja: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    cajaCajaDeposit: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    cajaCajaMovement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    cajaCajaReimbursement: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    accountingPeriod: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
    employee: { findFirst: vi.fn() },
    journalEntry: { aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
    transaction: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import { CreateCajaCajaSchema } from "../schemas/cajachica.schema";
import { CreateMovementSchema } from "../schemas/cajachica.schema";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const CAJA_ACCOUNT = "acc-caja";
const RETURN_ACCOUNT = "acc-banco";
const CUSTODIAN_ID = "emp-1";

// closeCajaCaja usa `new Date()` (hoy) para assertDateInOpenPeriod → el período
// mockeado DEBE coincidir con el año/mes ACTUAL del sistema, sin importar cuándo
// corra la suite (robusto frente a límites de mes).
const NOW = new Date();
const PERIOD_YEAR = NOW.getUTCFullYear();
const PERIOD_MONTH = NOW.getUTCMonth() + 1;
const OPEN_PERIOD = { id: "period-1", year: PERIOD_YEAR, month: PERIOD_MONTH, status: "OPEN" };

function makeCaja(overrides = {}) {
  return {
    id: "caja-1",
    companyId: COMPANY_ID,
    name: "Caja Operativa",
    accountId: CAJA_ACCOUNT,
    custodianId: CUSTODIAN_ID,
    currency: "VES",
    maxBalance: new Decimal("1000000"),
    status: "ACTIVE",
    createdAt: new Date(),
    createdBy: USER_ID,
    closedAt: null,
    closedBy: null,
    closeTransactionId: null,
    account: { id: CAJA_ACCOUNT, code: "1010", name: "Caja VES" },
    custodian: { id: CUSTODIAN_ID, firstName: "Ana", lastName: "Pérez" },
    deposits: [],
    movements: [],
    ...overrides,
  };
}

const validCreateInput = {
  companyId: COMPANY_ID,
  name: "Caja Operativa",
  accountId: CAJA_ACCOUNT,
  custodianId: CUSTODIAN_ID,
  currency: "VES" as const,
  maxBalance: "1000000",
};

// ─── Schema validation ────────────────────────────────────────────────────────

describe("CreateCajaCajaSchema", () => {
  it("acepta datos válidos", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja Principal",
      accountId: "acc-1",
      custodianId: CUSTODIAN_ID,
      currency: "VES",
      maxBalance: "500000",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza si falta custodianId (HC-03)", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja Principal",
      accountId: "acc-1",
      maxBalance: "500000",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza custodianId vacío (HC-03)", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja Principal",
      accountId: "acc-1",
      custodianId: "",
      maxBalance: "500000",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza maxBalance negativo", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      custodianId: CUSTODIAN_ID,
      maxBalance: "-1",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza maxBalance que excede el límite (ADR-006 D-2)", () => {
    const result = CreateCajaCajaSchema.safeParse({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      custodianId: CUSTODIAN_ID,
      maxBalance: "10000000001",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateMovementSchema", () => {
  const valid = {
    companyId: COMPANY_ID,
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    concept: "Café para reunión",
    expenseAccountId: "acc-expense",
    amount: "150000",
    currency: "VES",
    // HC-01 (ADR-037): supportingDocumentId SIEMPRE obligatorio (se eliminó el umbral 500k).
    supportingDocumentId: "FAC-001",
  };

  it("acepta movimiento válido con soporte (HC-01)", () => {
    expect(CreateMovementSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza movimiento sin supportingDocumentId (HC-01, cualquier monto)", () => {
    const { supportingDocumentId: _omit, ...sinSoporte } = valid;
    void _omit;
    expect(CreateMovementSchema.safeParse(sinSoporte).success).toBe(false);
  });

  it("rechaza movimiento USD sin soporte (HC-01 aplica a toda moneda)", () => {
    const { supportingDocumentId: _omit, ...sinSoporte } = valid;
    void _omit;
    const result = CreateMovementSchema.safeParse({
      ...sinSoporte,
      amount: "600000",
      currency: "USD",
    });
    expect(result.success).toBe(false);
  });
});

// ─── CajaCajaService.createCajaCaja ──────────────────────────────────────────

type TxOverrides = Record<string, unknown>;

/** tx mock con valores por defecto sanos para createCajaCaja, sobreescribibles. */
function makeCreateTx(overrides: TxOverrides = {}) {
  const cajaCreate = vi.fn().mockResolvedValue(makeCaja());
  const accountFindFirst = vi.fn().mockResolvedValue({ id: CAJA_ACCOUNT, type: "ASSET" });
  const employeeFindFirst = vi
    .fn()
    .mockResolvedValue({ id: CUSTODIAN_ID, companyId: COMPANY_ID, status: "ACTIVE" });
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    account: { findFirst: accountFindFirst },
    employee: { findFirst: employeeFindFirst },
    cajaCaja: { create: cajaCreate },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, cajaCreate, accountFindFirst, employeeFindFirst, auditCreate };
}

describe("createCajaCaja", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: persiste custodianId, serializa custodianName y crea audit log", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    const { cajaCreate, auditCreate } = makeCreateTx();

    const result = await createCajaCaja(validCreateInput, USER_ID);

    expect(result.id).toBe("caja-1");
    expect(result.availableBalance).toBe("0.00");
    expect(result.percentUsed).toBe(0);
    // HC-03: el custodio se serializa
    expect(result.custodianId).toBe(CUSTODIAN_ID);
    expect(result.custodianName).toBe("Ana Pérez");

    // create.data persiste custodianId
    expect(cajaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ custodianId: CUSTODIAN_ID }),
      })
    );
    // AuditLog incluye custodianId (R-6)
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_CAJA_CHICA",
          newValue: expect.objectContaining({ custodianId: CUSTODIAN_ID }),
        }),
      })
    );
  });

  it("serializa custodianName null si no hay custodio en el include", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    makeCreateTx({
      cajaCaja: {
        create: vi.fn().mockResolvedValue(makeCaja({ custodian: null, custodianId: null })),
      },
    });

    const result = await createCajaCaja(validCreateInput, USER_ID);
    expect(result.custodianId).toBeNull();
    expect(result.custodianName).toBeNull();
  });

  it("HC-09: rechaza si la cuenta de la caja NO es ASSET", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    const cajaCreate = vi.fn();
    makeCreateTx({
      account: { findFirst: vi.fn().mockResolvedValue({ id: CAJA_ACCOUNT, type: "EXPENSE" }) },
      cajaCaja: { create: cajaCreate },
    });

    await expect(createCajaCaja(validCreateInput, USER_ID)).rejects.toThrow(/Activo/i);
    expect(cajaCreate).not.toHaveBeenCalled();
  });

  it("HC-09: rechaza si la cuenta no existe / es de otra empresa", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    makeCreateTx({
      account: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(createCajaCaja(validCreateInput, USER_ID)).rejects.toThrow(
      /no encontrada|no pertenece/i
    );
  });

  it("HC-03: rechaza si el custodio no existe / es de otra empresa", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    const cajaCreate = vi.fn();
    makeCreateTx({
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
      cajaCaja: { create: cajaCreate },
    });

    await expect(createCajaCaja(validCreateInput, USER_ID)).rejects.toThrow(
      /custodio no existe|no pertenece/i
    );
    expect(cajaCreate).not.toHaveBeenCalled();
  });

  it("HC-03: rechaza si el custodio no está ACTIVE", async () => {
    const { createCajaCaja } = await import("../services/CajaCajaService");
    const cajaCreate = vi.fn();
    makeCreateTx({
      employee: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: CUSTODIAN_ID, companyId: COMPANY_ID, status: "INACTIVE" }),
      },
      cajaCaja: { create: cajaCreate },
    });

    await expect(createCajaCaja(validCreateInput, USER_ID)).rejects.toThrow(/activo/i);
    expect(cajaCreate).not.toHaveBeenCalled();
  });
});

// ─── CajaCajaService.assignCustodian ─────────────────────────────────────────

const NEW_CUSTODIAN_ID = "emp-2";

/** tx mock por defecto sano para assignCustodian, sobreescribible por bloque. */
function makeAssignTx(overrides: TxOverrides = {}) {
  // findFirst sobre la caja: select { id, status, custodianId }. Por defecto la
  // caja existe, está ACTIVE y ya tenía el custodio original (CUSTODIAN_ID).
  const cajaFindFirst = vi
    .fn()
    .mockResolvedValue({ id: "caja-1", status: "ACTIVE", custodianId: CUSTODIAN_ID });
  // update devuelve la caja completa (shape CAJA_INCLUDE) ya con el custodio nuevo,
  // serializable por serializeCaja.
  const cajaUpdate = vi.fn().mockResolvedValue(
    makeCaja({
      custodianId: NEW_CUSTODIAN_ID,
      custodian: { id: NEW_CUSTODIAN_ID, firstName: "Luis", lastName: "Gómez" },
    })
  );
  const employeeFindFirst = vi
    .fn()
    .mockResolvedValue({ id: NEW_CUSTODIAN_ID, status: "ACTIVE" });
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    cajaCaja: { findFirst: cajaFindFirst, update: cajaUpdate },
    employee: { findFirst: employeeFindFirst },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, cajaFindFirst, cajaUpdate, employeeFindFirst, auditCreate };
}

const assignInput = {
  cajaCajaId: "caja-1",
  companyId: COMPANY_ID,
  custodianId: NEW_CUSTODIAN_ID,
};

describe("assignCustodian", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy path: actualiza custodianId, serializa custodianName y audita old/new", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { cajaUpdate, auditCreate } = makeAssignTx();

    const result = await assignCustodian(assignInput, USER_ID);

    // serializa el custodio nuevo (no el viejo)
    expect(result.custodianId).toBe(NEW_CUSTODIAN_ID);
    expect(result.custodianName).toBe("Luis Gómez");

    // update.data persiste el custodianId nuevo + targeting por id de la caja
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "caja-1" },
        data: expect.objectContaining({ custodianId: NEW_CUSTODIAN_ID }),
      })
    );

    // AuditLog ASSIGN_CAJA_CHICA_CUSTODIAN con oldValue/newValue exactos (R-6)
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ASSIGN_CAJA_CHICA_CUSTODIAN",
          entityName: "CajaCaja",
          entityId: "caja-1",
          oldValue: { custodianId: CUSTODIAN_ID },
          newValue: { custodianId: NEW_CUSTODIAN_ID },
        }),
      })
    );
  });

  it("propaga ipAddress/userAgent al AuditLog (R-6)", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { auditCreate } = makeAssignTx();

    await assignCustodian(assignInput, USER_ID, "10.0.0.9", "vitest-UA");

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: "10.0.0.9", userAgent: "vitest-UA" }),
      })
    );
  });

  it("rechaza si la caja no existe / es de otra empresa", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { cajaUpdate, employeeFindFirst, auditCreate } = makeAssignTx({
      cajaCaja: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });

    await expect(assignCustodian(assignInput, USER_ID)).rejects.toThrow(/no encontrada/i);
    // no toca empleado, no actualiza, no audita
    expect(employeeFindFirst).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rechaza si la caja está CLOSED", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { cajaUpdate, employeeFindFirst } = makeAssignTx({
      cajaCaja: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "caja-1", status: "CLOSED", custodianId: CUSTODIAN_ID }),
        update: vi.fn(),
      },
    });

    await expect(assignCustodian(assignInput, USER_ID)).rejects.toThrow(/cerrada/i);
    expect(employeeFindFirst).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
  });

  it("rechaza si el custodio no existe / es de otra empresa (HC-03 cross-tenant)", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { cajaUpdate, auditCreate } = makeAssignTx({
      employee: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(assignCustodian(assignInput, USER_ID)).rejects.toThrow(
      /no existe|no pertenece/i
    );
    expect(cajaUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rechaza si el custodio no está ACTIVE (HC-03)", async () => {
    const { assignCustodian } = await import("../services/CajaCajaService");
    const { cajaUpdate } = makeAssignTx({
      employee: {
        findFirst: vi.fn().mockResolvedValue({ id: NEW_CUSTODIAN_ID, status: "INACTIVE" }),
      },
    });

    await expect(assignCustodian(assignInput, USER_ID)).rejects.toThrow(/activo/i);
    expect(cajaUpdate).not.toHaveBeenCalled();
  });
});

// ─── Balance computation ──────────────────────────────────────────────────────

describe("balance computation (indirect via getCajaCajaById)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computa saldo disponible correctamente", async () => {
    const { getCajaCajaById } = await import("../services/CajaCajaService");

    const cajaWithBalance = makeCaja({
      deposits: [{ amount: new Decimal("1000000") }],
      movements: [
        { amount: new Decimal("200000"), status: "APPROVED" },
        { amount: new Decimal("50000"), status: "PENDING" },
      ],
    });

    vi.mocked(prisma.cajaCaja.findFirst).mockResolvedValue(cajaWithBalance as never);

    const result = await getCajaCajaById("caja-1", COMPANY_ID);
    expect(result?.availableBalance).toBe("750000.00");
    expect(result?.totalApprovedMovements).toBe("200000.00");
    expect(result?.totalPendingMovements).toBe("50000.00");
  });
});

// ─── closeCajaCaja ────────────────────────────────────────────────────────────

/** tx mock por defecto sano para closeCajaCaja, sobreescribible por bloque. */
function makeCloseTx(overrides: TxOverrides = {}, remaining: string | number = 0) {
  const findFirst = vi.fn().mockResolvedValue(makeCaja({ movements: [] }));
  const cajaUpdate = vi.fn().mockResolvedValue({});
  const cajaCount = vi.fn().mockResolvedValue(0);
  const accountFindFirst = vi.fn().mockResolvedValue({ id: RETURN_ACCOUNT, type: "ASSET" });
  const periodFindFirst = vi.fn().mockResolvedValue(OPEN_PERIOD);
  const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: new Decimal(remaining) } });
  const txCreate = vi.fn().mockResolvedValue({ id: "tx-liq" });
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    cajaCaja: { findFirst, update: cajaUpdate, count: cajaCount },
    account: { findFirst: accountFindFirst },
    accountingPeriod: { findFirst: periodFindFirst },
    journalEntry: { aggregate },
    transaction: { create: txCreate },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return { tx, findFirst, cajaUpdate, cajaCount, accountFindFirst, aggregate, txCreate, auditCreate };
}

const closeInput = {
  cajaCajaId: "caja-1",
  companyId: COMPANY_ID,
  returnAccountId: RETURN_ACCOUNT,
};

describe("closeCajaCaja", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza si la caja no existe", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    makeCloseTx({ cajaCaja: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), count: vi.fn() } });
    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(/no encontrada/i);
  });

  it("rechaza si la caja ya está cerrada", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    makeCloseTx({
      cajaCaja: {
        findFirst: vi.fn().mockResolvedValue(makeCaja({ status: "CLOSED", movements: [] })),
        update: vi.fn(),
        count: vi.fn(),
      },
    });
    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(/ya está cerrada/i);
  });

  it("rechaza cierre con movimientos pendientes", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    makeCloseTx({
      cajaCaja: {
        findFirst: vi.fn().mockResolvedValue(makeCaja({ movements: [{ status: "PENDING" }] })),
        update: vi.fn(),
        count: vi.fn(),
      },
    });
    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(
      "No se puede cerrar con movimientos pendientes"
    );
  });

  it("ADR-036 D-2.4: rechaza si la cuenta de retorno NO es ASSET", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { cajaUpdate } = makeCloseTx({
      account: { findFirst: vi.fn().mockResolvedValue({ id: RETURN_ACCOUNT, type: "EXPENSE" }) },
    });
    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(/Activo/i);
    expect(cajaUpdate).not.toHaveBeenCalled();
  });

  it("ADR-036 D-2.4: rechaza si la cuenta de retorno es la misma de la caja", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { cajaUpdate } = makeCloseTx({
      account: { findFirst: vi.fn().mockResolvedValue({ id: CAJA_ACCOUNT, type: "ASSET" }) },
    });
    await expect(
      closeCajaCaja({ ...closeInput, returnAccountId: CAJA_ACCOUNT }, USER_ID)
    ).rejects.toThrow(/distinta/i);
    expect(cajaUpdate).not.toHaveBeenCalled();
  });

  it("remanente == 0: cierra sin crear Transaction, closeTransactionId null", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate, auditCreate } = makeCloseTx({}, 0);

    await closeCajaCaja(closeInput, USER_ID);

    expect(txCreate).not.toHaveBeenCalled();
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "caja-1" },
        data: expect.objectContaining({ status: "CLOSED", closeTransactionId: null }),
      })
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CLOSE_CAJA_CHICA",
          newValue: expect.objectContaining({
            returnAccountId: RETURN_ACCOUNT,
            remainingAmount: "0.00",
            closeTransactionId: null,
          }),
        }),
      })
    );
  });

  it("remanente > 0: crea asiento balanceado Dr retorno / Cr caja y enlaza closeTransactionId", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate, auditCreate } = makeCloseTx({}, "350000");

    await closeCajaCaja(closeInput, USER_ID);

    expect(txCreate).toHaveBeenCalledTimes(1);
    const entries = txCreate.mock.calls[0][0].data.entries.create as Array<{
      accountId: string;
      amount: Decimal;
    }>;
    expect(entries).toHaveLength(2);

    const dr = entries.find((e) => e.accountId === RETURN_ACCOUNT)!;
    const cr = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;
    expect(dr.amount.toString()).toBe("350000");
    expect(cr.amount.toString()).toBe("-350000");

    // Balanceado (Σ = 0) con Decimal (R-1 / R-5)
    const sum = entries.reduce((a, e) => a.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);

    // Enlaza closeTransactionId al cerrar
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CLOSED", closeTransactionId: "tx-liq" }),
      })
    );

    // AuditLog con returnAccountId + remainingAmount (R-6)
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({
            returnAccountId: RETURN_ACCOUNT,
            remainingAmount: "350000.00",
            closeTransactionId: "tx-liq",
          }),
        }),
      })
    );
  });

  it("remanente > 0 con decimales: el asiento usa Decimal exacto (R-5)", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate } = makeCloseTx({}, "1333.33");

    await closeCajaCaja(closeInput, USER_ID);

    const entries = txCreate.mock.calls[0][0].data.entries.create as Array<{
      accountId: string;
      amount: Decimal;
    }>;
    const dr = entries.find((e) => e.accountId === RETURN_ACCOUNT)!;
    const cr = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;
    expect(dr.amount.toString()).toBe("1333.33");
    expect(cr.amount.toString()).toBe("-1333.33");
    expect(entries.reduce((a, e) => a.plus(e.amount), new Decimal(0)).isZero()).toBe(true);
  });

  it("remanente < 0: lanza error de integridad y NO cierra (sin asiento, sin update)", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate } = makeCloseTx({}, "-100");

    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(/acreedor/i);
    expect(txCreate).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
  });

  it("Z-1: traduce P2002 en el correlativo a error transitorio reintentable", async () => {
    const { closeCajaCaja } = await import("../services/CajaCajaService");
    makeCloseTx(
      {
        transaction: {
          create: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" })),
        },
      },
      "500000"
    );
    await expect(closeCajaCaja(closeInput, USER_ID)).rejects.toThrow(/transitorio/i);
  });
});

// ─── reopenCajaCaja (F-17, ADR-038) ─────────────────────────────────────────────

const REOP_CLOSE_TX_ID = "tx-liq-original";

/**
 * tx mock por defecto sano para reopenCajaCaja, sobreescribible por bloque.
 *
 * Por defecto: caja CLOSED con un asiento de liquidación POSTED real (las dos
 * entries del cierre: Dr returnAccount(+X) / Cr caja(−X)). reopenCajaCaja debe
 * crear la reversa espejo (Dr caja(+X) / Cr returnAccount(−X)), marcar el
 * original VOIDED y restaurar la caja a ACTIVE.
 */
function makeReopenTx(
  overrides: TxOverrides = {},
  closeAmount: string | number = "350000",
  cajaOverrides: Record<string, unknown> = {}
) {
  const closedCaja = makeCaja({
    status: "CLOSED",
    closedAt: new Date(),
    closedBy: USER_ID,
    closeTransactionId: REOP_CLOSE_TX_ID,
    ...cajaOverrides,
  });
  const cajaFindFirst = vi.fn().mockResolvedValue(closedCaja);
  const cajaUpdate = vi.fn().mockResolvedValue({});

  // El asiento de liquidación ORIGINAL, POSTED, con sus 2 entries reales:
  // Dr returnAccount(+X) / Cr caja(−X) (lo que dejó closeCajaCaja).
  const originalCloseTx = {
    id: REOP_CLOSE_TX_ID,
    status: "POSTED" as string,
    entries: [
      { accountId: RETURN_ACCOUNT, amount: new Decimal(closeAmount) },
      { accountId: CAJA_ACCOUNT, amount: new Decimal(closeAmount).negated() },
    ],
  };
  const txFindFirst = vi.fn().mockResolvedValue(originalCloseTx);
  const txCreate = vi.fn().mockResolvedValue({ id: "tx-reop" });
  const txUpdate = vi.fn().mockResolvedValue({});
  const txCount = vi.fn().mockResolvedValue(0);

  const periodFindFirst = vi.fn().mockResolvedValue(OPEN_PERIOD);
  const auditCreate = vi.fn().mockResolvedValue({});

  const tx = {
    cajaCaja: { findFirst: cajaFindFirst, update: cajaUpdate },
    transaction: {
      findFirst: txFindFirst,
      create: txCreate,
      update: txUpdate,
      count: txCount,
    },
    accountingPeriod: { findFirst: periodFindFirst },
    auditLog: { create: auditCreate },
    ...overrides,
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (t: unknown) => unknown) => fn(tx)) as never
  );
  return {
    tx,
    cajaFindFirst,
    cajaUpdate,
    txFindFirst,
    txCreate,
    txUpdate,
    txCount,
    periodFindFirst,
    auditCreate,
  };
}

const reopenInput = {
  cajaCajaId: "caja-1",
  companyId: COMPANY_ID,
};

describe("reopenCajaCaja", () => {
  beforeEach(() => vi.clearAllMocks());

  it("happy con reversa: crea asiento espejo balanceado, marca original VOIDED, restaura ACTIVE y audita", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, txUpdate, cajaUpdate, auditCreate } = makeReopenTx({}, "350000");

    await reopenCajaCaja(reopenInput, USER_ID);

    // 1) Crea exactamente UN asiento de reversa.
    expect(txCreate).toHaveBeenCalledTimes(1);
    const data = txCreate.mock.calls[0][0].data as {
      number: string;
      entries: { create: Array<{ accountId: string; amount: Decimal }> };
    };

    // Correlativo CCC-REOP-NNNNNN.
    expect(data.number).toMatch(/^CCC-REOP-\d{6}$/);
    expect(data.number).toBe("CCC-REOP-000001");

    // Entries ESPEJO del cierre: Dr caja(+X) / Cr returnAccount(−X) — signos invertidos.
    const entries = data.entries.create;
    expect(entries).toHaveLength(2);
    const cajaEntry = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;
    const returnEntry = entries.find((e) => e.accountId === RETURN_ACCOUNT)!;
    expect(cajaEntry.amount.toString()).toBe("350000"); // antes era −350000 → reversa +
    expect(returnEntry.amount.toString()).toBe("-350000"); // antes era +350000 → reversa −

    // Balanceada (Σ = 0) con Decimal (R-1 / R-5).
    const sum = entries.reduce((a, e) => a.plus(e.amount), new Decimal(0));
    expect(sum.isZero()).toBe(true);

    // 2) Marca el asiento ORIGINAL como VOIDED (R-1: nunca borra).
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REOP_CLOSE_TX_ID },
        data: expect.objectContaining({ status: "VOIDED" }),
      })
    );

    // 3) Restaura la caja a ACTIVE limpiando closedAt/closedBy/closeTransactionId.
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "caja-1" },
        data: expect.objectContaining({
          status: "ACTIVE",
          closedAt: null,
          closedBy: null,
          closeTransactionId: null,
        }),
      })
    );

    // 4) AuditLog REOPEN_CAJA_CHICA con reversalTransactionId y old/new (R-6).
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REOPEN_CAJA_CHICA",
          entityName: "CajaCaja",
          entityId: "caja-1",
          oldValue: expect.objectContaining({ closeTransactionId: REOP_CLOSE_TX_ID }),
          newValue: expect.objectContaining({
            status: "ACTIVE",
            reversalTransactionId: "tx-reop",
            closeTransactionAlreadyVoided: false,
          }),
        }),
      })
    );
  });

  it("happy con reversa con decimales: el asiento espejo usa Decimal exacto (R-5)", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate } = makeReopenTx({}, "1333.33");

    await reopenCajaCaja(reopenInput, USER_ID);

    const entries = txCreate.mock.calls[0][0].data.entries.create as Array<{
      accountId: string;
      amount: Decimal;
    }>;
    const cajaEntry = entries.find((e) => e.accountId === CAJA_ACCOUNT)!;
    const returnEntry = entries.find((e) => e.accountId === RETURN_ACCOUNT)!;
    expect(cajaEntry.amount.toString()).toBe("1333.33");
    expect(returnEntry.amount.toString()).toBe("-1333.33");
    expect(entries.reduce((a, e) => a.plus(e.amount), new Decimal(0)).isZero()).toBe(true);
  });

  it("happy SIN reversa: closeTransactionId null → no crea Transaction, solo restaura ACTIVE; audita reversalTransactionId null", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txFindFirst, txCreate, txUpdate, cajaUpdate, auditCreate } = makeReopenTx(
      {},
      "0",
      { closeTransactionId: null }
    );

    await reopenCajaCaja(reopenInput, USER_ID);

    // Sin asiento de cierre → ni se consulta el original ni se crea/voidea reversa.
    expect(txFindFirst).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();

    // Restaura igualmente el estado operativo.
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACTIVE",
          closedAt: null,
          closedBy: null,
          closeTransactionId: null,
        }),
      })
    );

    // AuditLog con reversalTransactionId null y closeTransactionAlreadyVoided false.
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "REOPEN_CAJA_CHICA",
          newValue: expect.objectContaining({
            status: "ACTIVE",
            reversalTransactionId: null,
            closeTransactionAlreadyVoided: false,
          }),
        }),
      })
    );
  });

  it("edge: original ya VOIDED → no crea reversa, restaura estado, audita closeTransactionAlreadyVoided:true", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, txUpdate, cajaUpdate, auditCreate } = makeReopenTx({
      transaction: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: REOP_CLOSE_TX_ID, status: "VOIDED", entries: [] }),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    });

    await reopenCajaCaja(reopenInput, USER_ID);

    // A.6: no segunda contrapartida.
    expect(txCreate).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();

    // Pero sí restaura estado.
    expect(cajaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE", closeTransactionId: null }),
      })
    );

    // AuditLog marca el flag.
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({
            reversalTransactionId: null,
            closeTransactionAlreadyVoided: true,
          }),
        }),
      })
    );
  });

  it("edge: original no existe (null) → trata como ya VOIDED (closeTransactionAlreadyVoided:true), restaura estado", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, txUpdate, auditCreate } = makeReopenTx({
      transaction: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    });

    await reopenCajaCaja(reopenInput, USER_ID);

    expect(txCreate).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValue: expect.objectContaining({ closeTransactionAlreadyVoided: true }),
        }),
      })
    );
  });

  it("rechaza si la caja no existe / es de otra empresa → no crea reversa, no restaura", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate, auditCreate } = makeReopenTx({
      cajaCaja: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    });

    await expect(reopenCajaCaja(reopenInput, USER_ID)).rejects.toThrow(/no encontrada/i);
    expect(txCreate).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("rechaza si la caja NO está CLOSED (p.ej. ACTIVE) → no crea reversa, no restaura", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate } = makeReopenTx({
      cajaCaja: {
        findFirst: vi.fn().mockResolvedValue(makeCaja({ status: "ACTIVE" })),
        update: vi.fn(),
      },
    });

    await expect(reopenCajaCaja(reopenInput, USER_ID)).rejects.toThrow(/cerrada/i);
    expect(txCreate).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
  });

  it("Z-1: traduce P2002 en el correlativo de reversa a error transitorio reintentable", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    makeReopenTx({
      transaction: {
        findFirst: vi.fn().mockResolvedValue({
          id: REOP_CLOSE_TX_ID,
          status: "POSTED",
          entries: [
            { accountId: RETURN_ACCOUNT, amount: new Decimal("500000") },
            { accountId: CAJA_ACCOUNT, amount: new Decimal("-500000") },
          ],
        }),
        create: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" })),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    });

    await expect(reopenCajaCaja(reopenInput, USER_ID)).rejects.toThrow(/transitorio/i);
  });

  it("sin período OPEN con reversa pendiente → propaga error de período (no crea reversa, no restaura)", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { txCreate, cajaUpdate, auditCreate } = makeReopenTx({
      accountingPeriod: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(reopenCajaCaja(reopenInput, USER_ID)).rejects.toThrow();
    expect(txCreate).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("propaga ipAddress/userAgent al AuditLog (R-6)", async () => {
    const { reopenCajaCaja } = await import("../services/CajaCajaService");
    const { auditCreate } = makeReopenTx({}, "100");

    await reopenCajaCaja(reopenInput, USER_ID, "10.0.0.7", "vitest-UA");

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ipAddress: "10.0.0.7", userAgent: "vitest-UA" }),
      })
    );
  });
});
