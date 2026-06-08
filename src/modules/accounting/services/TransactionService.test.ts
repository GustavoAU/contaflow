// src/modules/accounting/services/TransactionService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    transaction: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    fiscalYearClose: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { TransactionService } from "./TransactionService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRow(id: string) {
  return {
    id,
    number: `2026-04-${id.padStart(6, "0")}`,
    date: new Date("2026-04-01"),
    description: `Asiento ${id}`,
    status: "POSTED",
    type: "DIARIO",
    entries: [],
  };
}

const BASE_INPUT = {
  companyId: "company-1",
  userId: "user-1",
  description: "Compra de suministros",
  date: new Date("2026-03-10"),
  type: "DIARIO" as const,
  entries: [
    { accountId: "acc-1", debit: "1000", credit: "0" },
    { accountId: "acc-2", debit: "0", credit: "1000" },
  ],
};

// ─── generateTransactionNumber ────────────────────────────────────────────────

describe("generateTransactionNumber", () => {
  beforeEach(() => vi.clearAllMocks());

  it("genera el primer numero del mes si no hay asientos", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-03-10"),
      prisma as never,
    );
    expect(number).toBe("2026-03-000001");
  });

  it("incrementa el numero correctamente", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      number: "2026-03-000005",
    } as never);
    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-03-10"),
      prisma as never,
    );
    expect(number).toBe("2026-03-000006");
  });

  it("reinicia el contador en un nuevo mes", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const number = await TransactionService.generateTransactionNumber(
      "company-1",
      new Date("2026-04-01"),
      prisma as never,
    );
    expect(number).toBe("2026-04-000001");
  });

  it("es independiente por empresa", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const number = await TransactionService.generateTransactionNumber(
      "company-2",
      new Date("2026-03-10"),
      prisma as never,
    );
    expect(number).toBe("2026-03-000001");
    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-2" }),
      })
    );
  });
});

// ─── createBalancedTransaction ────────────────────────────────────────────────

describe("createBalancedTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ejercicio no cerrado por defecto
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
  });

  it("crea la transaccion correctamente en el happy path", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: "acc-1" },
      { id: "acc-2" },
    ] as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      status: "OPEN",
    } as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

    const createdTx = {
      id: "tx-1",
      number: "2026-03-000001",
      entries: [],
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        ...prisma,
        transaction: { ...prisma.transaction, create: vi.fn().mockResolvedValue(createdTx) },
        auditLog: { create: vi.fn() },
      } as never)
    );

    const result = await TransactionService.createBalancedTransaction(BASE_INPUT);

    expect(result).toMatchObject({ id: "tx-1", number: "2026-03-000001" });
  });

  it("lanza error si alguna cuenta no pertenece a la empresa", async () => {
    // Solo devuelve 1 de las 2 cuentas solicitadas
    vi.mocked(prisma.account.findMany).mockResolvedValue([{ id: "acc-1" }] as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
    } as never);

    await expect(TransactionService.createBalancedTransaction(BASE_INPUT)).rejects.toThrow(
      "Cuentas no encontradas o no pertenecen a esta empresa"
    );
  });

  it("lanza error si el ejercicio economico esta cerrado", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: "acc-1" },
      { id: "acc-2" },
    ] as never);
    // Simular ejercicio cerrado
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({
      id: "fyc-1",
      year: 2026,
    } as never);

    await expect(TransactionService.createBalancedTransaction(BASE_INPUT)).rejects.toThrow(
      "El ejercicio económico 2026 está cerrado"
    );
  });

  it("lanza error si no hay periodo contable abierto", async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: "acc-1" },
      { id: "acc-2" },
    ] as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(TransactionService.createBalancedTransaction(BASE_INPUT)).rejects.toThrow(
      "No hay período contable abierto"
    );
  });

  it("lanza error de Zod si partida doble no cuadra", async () => {
    await expect(
      TransactionService.createBalancedTransaction({
        ...BASE_INPUT,
        entries: [
          { accountId: "acc-1", debit: "1000", credit: "0" },
          { accountId: "acc-2", debit: "0", credit: "500" }, // no cuadra
        ],
      })
    ).rejects.toThrow();
  });
});

// ─── voidTransaction ──────────────────────────────────────────────────────────

describe("voidTransaction", () => {
  beforeEach(() => vi.clearAllMocks());

  const ORIGINAL_TX = {
    id: "tx-original",
    number: "2026-03-000001",
    companyId: "company-1",
    userId: "user-1",
    description: "Compra de suministros",
    reference: null,
    date: new Date("2026-03-10"),
    type: "DIARIO",
    status: "POSTED",
    periodId: "period-1",
    entries: [
      { id: "entry-1", accountId: "acc-1", amount: { toString: () => "1000" } },
      { id: "entry-2", accountId: "acc-2", amount: { toString: () => "-1000" } },
    ],
  };

  it("anula la transaccion correctamente en el happy path", async () => {
    // findFirst: 1ª = outer void lookup, 2ª = generateTransactionNumber dentro del $transaction (via tx spread)
    vi.mocked(prisma.transaction.findFirst)
      .mockResolvedValueOnce(ORIGINAL_TX as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 3 } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);

    const voidTx = { id: "tx-void", number: "2026-03-000002", entries: [] };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        ...prisma,
        transaction: {
          ...prisma.transaction,
          create: vi.fn().mockResolvedValue(voidTx),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn() },
      } as never)
    );

    const result = await TransactionService.voidTransaction(
      { transactionId: "tx-original", userId: "user-1", reason: "Error en el monto" },
      "company-1"
    );

    expect(result).toMatchObject({ id: "tx-void" });
  });

  it("lanza error si la transaccion no existe", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(null);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-inexistente", userId: "user-1", reason: "Error en el registro" },
        "company-1"
      )
    ).rejects.toThrow("Transaccion no encontrada");
  });

  it("lanza error cross-tenant: transaccion de otra empresa (ADR-004)", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(null); // companyId "company-2" no devuelve nada

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Acceso no autorizado" },
        "company-2" // empresa diferente
      )
    ).rejects.toThrow("Transaccion no encontrada");
  });

  it("lanza error si la transaccion ya fue anulada (guard VOID doble)", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce({
      ...ORIGINAL_TX,
      status: "VOIDED",
    } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Intento duplicado" },
        "company-1"
      )
    ).rejects.toThrow("Esta transaccion ya fue anulada anteriormente");
  });

  it("crea el asiento espejo con montos invertidos", async () => {
    vi.mocked(prisma.transaction.findFirst)
      .mockResolvedValueOnce(ORIGINAL_TX as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 3 } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);

    const createMock = vi.fn().mockResolvedValue({ id: "tx-void", entries: [] });
    const updateMock = vi.fn().mockResolvedValue({});
    const auditMock = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        ...prisma,
        transaction: { ...prisma.transaction, create: createMock, update: updateMock },
        auditLog: { create: auditMock },
      } as never)
    );

    await TransactionService.voidTransaction(
      { transactionId: "tx-original", userId: "user-1", reason: "Error en el monto" },
      "company-1"
    );

    const createCall = createMock.mock.calls[0][0];
    expect(createCall.data.entries.create).toHaveLength(2);
    expect(createCall.data.entries.create[0].amount.toString()).toBe("-1000");
    expect(createCall.data.entries.create[1].amount.toString()).toBe("1000");
    expect(createCall.data.description).toContain("ANULACION:");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tx-original" },
        data: expect.objectContaining({ status: "VOIDED" }),
      })
    );

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityId: "tx-original",
          action: "VOID",
        }),
      })
    );
  });

  it("hard-lock: lanza error si el período del asiento (por FK) está CLOSED", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(ORIGINAL_TX as never);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({
      id: "period-1",
      status: "CLOSED",
      year: 2026,
      month: 3,
    } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Intento en período cerrado" },
        "company-1"
      )
    ).rejects.toThrow("No se puede anular un asiento en un período cerrado");
  });

  it("hard-lock: lanza error si el asiento no tiene periodId (fail-safe)", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce({
      ...ORIGINAL_TX,
      periodId: null,
    } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Asiento sin período asignado" },
        "company-1"
      )
    ).rejects.toThrow("El asiento no tiene período contable asignado");
  });

  it("hard-lock: lanza error si el año fiscal del período de anulación está cerrado", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(ORIGINAL_TX as never);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 3 } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Intento con año fiscal cerrado" },
        "company-1"
      )
    ).rejects.toThrow("año fiscal");
  });

  it("hard-lock: lanza error si no hay período activo para el asiento de anulación", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(ORIGINAL_TX as never);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 3 } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);

    await expect(
      TransactionService.voidTransaction(
        { transactionId: "tx-original", userId: "user-1", reason: "Sin período activo disponible" },
        "company-1"
      )
    ).rejects.toThrow("No hay período contable abierto");
  });

  it("hard-lock: permite anular si el período está OPEN", async () => {
    vi.mocked(prisma.transaction.findFirst)
      .mockResolvedValueOnce(ORIGINAL_TX as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({ id: "period-1", status: "OPEN", year: 2026, month: 3 } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);

    const voidTx = { id: "tx-void", number: "2026-03-000002", entries: [] };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        ...prisma,
        transaction: {
          ...prisma.transaction,
          create: vi.fn().mockResolvedValue(voidTx),
          update: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn() },
      } as never)
    );

    const result = await TransactionService.voidTransaction(
      { transactionId: "tx-original", userId: "user-1", reason: "Corrección en período abierto" },
      "company-1"
    );

    expect(result).toMatchObject({ id: "tx-void" });
  });
});

// ─── getTransactionsByCompany ─────────────────────────────────────────────────

describe("getTransactionsByCompany", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna resúmenes de Libro Diario ordenados por fecha desc (R-1: sin entry detail)", async () => {
    const rows = [makeRow("2"), makeRow("1")];
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsByCompany("company-1");

    expect(result).toHaveLength(2);
    // R-1: el resultado es un resumen — no expone entries individuales
    expect(result[0]).not.toHaveProperty("entries");
    // R-5: totalDebit es string calculado con Decimal, no Number()
    expect(result[0]).toHaveProperty("totalDebit", "0.00");
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1" },
        orderBy: { date: "desc" },
      })
    );
  });

  it("retorna array vacio si la empresa no tiene transacciones", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);

    const result = await TransactionService.getTransactionsByCompany("company-nueva");

    expect(result).toEqual([]);
  });

  it("totalDebit calculado correctamente con Decimal.js (R-5)", async () => {
    const rowWithEntries = {
      ...makeRow("1"),
      entries: [
        { amount: { toString: () => "1000.00" } },
        { amount: { toString: () => "-1000.00" } },
        { amount: { toString: () => "500.00" } },
      ],
    };
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([rowWithEntries] as never);

    const result = await TransactionService.getTransactionsByCompany("company-1");

    expect(result[0].totalDebit).toBe("1500.00");
  });
});

// ─── getTransactionsPaginated ─────────────────────────────────────────────────

describe("getTransactionsPaginated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("primera página sin cursor retorna hasta 50 items", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsPaginated("company-1");

    expect(result.data).toHaveLength(50);
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51, where: { companyId: "company-1" } })
    );
  });

  it("retorna hasNextPage=true cuando hay más items", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsPaginated("company-1");

    expect(result.hasNextPage).toBe(true);
    expect(result.data).toHaveLength(50);
  });

  it("retorna nextCursor con el id del último item de la página", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsPaginated("company-1");

    expect(result.nextCursor).toBe(rows[49].id);
  });

  it("segunda página con cursor retorna items siguientes", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeRow(String(i + 51)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsPaginated("company-1", "50", 50);

    expect(result.data).toHaveLength(30);
    expect(result.hasNextPage).toBe(false);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "50" }, skip: 1 })
    );
  });

  it("última página retorna hasNextPage=false y nextCursor=null", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(String(i + 91)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.getTransactionsPaginated("company-1", "90", 50);

    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(10);
  });

  it("limita a 50 aunque se pida un limit mayor", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    await TransactionService.getTransactionsPaginated("company-1", undefined, 200);

    // take debe ser min(200, 50) + 1 = 51
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
  });

  it("filtra por periodId cuando se provee el cuarto parámetro", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);

    await TransactionService.getTransactionsPaginated("company-1", undefined, 50, "period-1");

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", periodId: "period-1" },
      })
    );
  });

  it("no incluye periodId en where cuando no se provee", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);

    await TransactionService.getTransactionsPaginated("company-1");

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1" },
      })
    );
  });
});

// ─── listTransactions (TransactionListParams) ─────────────────────────────────

describe("TransactionService.listTransactions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delega en getTransactionsPaginated y retorna página correcta", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.listTransactions({
      companyId: "company-1",
      periodId: "period-X",
      limit: 10,
    });

    expect(result.data).toHaveLength(3);
    expect(result.hasNextPage).toBe(false);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: "company-1", periodId: "period-X" },
        take: 11,
      })
    );
  });

  it("primera página sin cursor ni periodId retorna hasta 50 items", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow(String(i + 1)));
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.listTransactions({ companyId: "company-1" });

    expect(result.data).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51, where: { companyId: "company-1" } })
    );
  });

  it("segunda página con cursor retorna items siguientes", async () => {
    const rows = [makeRow("51"), makeRow("52")];
    vi.mocked(prisma.transaction.findMany).mockResolvedValue(rows as never);

    const result = await TransactionService.listTransactions({
      companyId: "company-1",
      cursor: "50",
      limit: 5,
    });

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "50" }, skip: 1 })
    );
    expect(result.data).toHaveLength(2);
  });

  it("lista con 0 items retorna data=[], nextCursor=null, hasNextPage=false", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([] as never);

    const result = await TransactionService.listTransactions({ companyId: "company-1" });

    expect(result.data).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
    expect(result.hasNextPage).toBe(false);
  });
});
