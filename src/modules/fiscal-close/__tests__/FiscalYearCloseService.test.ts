// src/modules/fiscal-close/__tests__/FiscalYearCloseService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    fiscalYearClose: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    // ADR-055: closeFiscalYear ahora resuelve el FiscalYear y cierra sus 12 períodos
    // en la misma tx (ya no es precondición externa cerrarlos uno a uno antes).
    fiscalYear: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    accountingPeriod: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    journalEntry: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)
  ),
}));

// ADR-055: closeFiscalYear ahora llama a PeriodSnapshotService dentro de la tx (una
// vez por período) — mockeado como colaborador en vez de replicar sus queries internas.
vi.mock("@/modules/accounting/services/PeriodSnapshotService", () => ({
  PeriodSnapshotService: {
    upsertAllSnapshotsForPeriod: vi.fn().mockResolvedValue(0),
  },
}));

import prisma from "@/lib/prisma";
import { FiscalYearCloseService } from "../services/FiscalYearCloseService";

const COMPANY_ID = "company-1";
const YEAR = 2025;
const USER_ID = "user-1";

const mockFiscalYear = {
  id: "fy-1",
  companyId: COMPANY_ID,
  year: YEAR,
  startMonth: 1,
  status: "OPEN",
  openedAt: new Date("2025-01-01"),
  openedBy: "user-1",
  closedAt: null,
  closedBy: null,
};

const mockPeriods = [
  { id: "period-1", year: YEAR, month: 1, status: "OPEN" },
  { id: "period-2", year: YEAR, month: 12, status: "OPEN" },
];

const mockCompany = {
  resultAccountId: "account-result",
  retainedEarningsAccountId: "account-retained",
  resultAccount: { id: "account-result", type: "EQUITY", name: "Resultado del Ejercicio" },
};

const mockRevenueEntries = [
  {
    amount: new Decimal("-10000"),
    accountId: "account-revenue-1",
    account: { id: "account-revenue-1", name: "Ventas", code: "4.1.01" },
  },
];

const mockExpenseEntries = [
  {
    amount: new Decimal("6000"),
    accountId: "account-expense-1",
    account: { id: "account-expense-1", name: "Costo de Ventas", code: "5.1.01" },
  },
];

function setupTxMock() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        fiscalYearClose: prisma.fiscalYearClose,
        fiscalYear: prisma.fiscalYear,
        accountingPeriod: prisma.accountingPeriod,
        company: prisma.company,
        transaction: prisma.transaction,
        journalEntry: prisma.journalEntry,
        auditLog: prisma.auditLog,
      })) as never
  );
}

describe("FiscalYearCloseService.isFiscalYearClosed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when FiscalYearClose record exists", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);
    const result = await FiscalYearCloseService.isFiscalYearClosed(COMPANY_ID, YEAR);
    expect(result).toBe(true);
  });

  it("returns false when no record exists", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    const result = await FiscalYearCloseService.isFiscalYearClosed(COMPANY_ID, YEAR);
    expect(result).toBe(false);
  });
});

describe("FiscalYearCloseService.closeFiscalYear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTxMock();
  });

  it("throws if fiscal year is already closed", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({ id: "fyc-1" } as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`El ejercicio económico ${YEAR} ya está cerrado.`);
  });

  it("throws if no FiscalYear exists for the year", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`No existe un ejercicio fiscal ${YEAR} para esta empresa.`);
  });

  it("throws if the FiscalYear is already CLOSED", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
      ...mockFiscalYear,
      status: "CLOSED",
    } as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`El ejercicio fiscal ${YEAR} ya está cerrado.`);
  });

  it("throws if the FiscalYear has no periods (dato inconsistente)", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([] as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`El ejercicio fiscal ${YEAR} no tiene períodos contables asociados`);
  });

  it("throws if closing accounts are not configured", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(mockPeriods as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      resultAccountId: null,
      retainedEarningsAccountId: null,
      resultAccount: null,
    } as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow("Cuentas de cierre no configuradas");
  });

  it("throws if result account is not EQUITY", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(mockPeriods as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      resultAccountId: "account-result",
      retainedEarningsAccountId: "account-retained",
      resultAccount: { id: "account-result", type: "ASSET", name: "Caja" },
    } as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow('no es de tipo Patrimonio (EQUITY)');
  });

  it("throws if no movements in result accounts", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(mockPeriods as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([] as never);

    await expect(
      FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`No hay movimientos en cuentas de resultado para el ejercicio ${YEAR}.`);
  });

  it("creates closing transaction and FiscalYearClose record on success", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(mockPeriods as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.journalEntry.findMany)
      .mockResolvedValueOnce(mockRevenueEntries as never) // REVENUE
      .mockResolvedValueOnce(mockExpenseEntries as never); // EXPENSE
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-closing-1" } as never);
    vi.mocked(prisma.accountingPeriod.updateMany).mockResolvedValue({ count: mockPeriods.length } as never);
    vi.mocked(prisma.fiscalYear.update).mockResolvedValue({ ...mockFiscalYear, status: "CLOSED" } as never);
    vi.mocked(prisma.fiscalYearClose.create).mockResolvedValue({ id: "fyc-new" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID);

    expect(result.fiscalYearCloseId).toBe("fyc-new");
    expect(result.closingTransactionId).toBe("tx-closing-1");
    // Revenue = 10000, Expenses = 6000, Net = 4000 (ganancia)
    expect(result.totalRevenue.toString()).toBe("10000");
    expect(result.totalExpenses.toString()).toBe("6000");
    expect(result.netResult.toString()).toBe("4000");
    expect(prisma.transaction.create).toHaveBeenCalledOnce();
    expect(prisma.fiscalYearClose.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
    // ADR-055 D-B: cierra los períodos + el FiscalYear en la misma tx
    expect(prisma.accountingPeriod.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED" }) })
    );
    expect(prisma.fiscalYear.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED" }) })
    );
  });

  it("correctly handles a net loss scenario (expenses > revenue)", async () => {
    const lossRevenueEntries = [
      {
        amount: new Decimal("-3000"),
        accountId: "acc-rev",
        account: { id: "acc-rev", name: "Ventas", code: "4.1" },
      },
    ];
    const lossExpenseEntries = [
      {
        amount: new Decimal("8000"),
        accountId: "acc-exp",
        account: { id: "acc-exp", name: "Gastos", code: "5.1" },
      },
    ];

    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(mockFiscalYear as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(mockPeriods as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(mockCompany as never);
    vi.mocked(prisma.journalEntry.findMany)
      .mockResolvedValueOnce(lossRevenueEntries as never)
      .mockResolvedValueOnce(lossExpenseEntries as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-loss" } as never);
    vi.mocked(prisma.accountingPeriod.updateMany).mockResolvedValue({ count: mockPeriods.length } as never);
    vi.mocked(prisma.fiscalYear.update).mockResolvedValue({ ...mockFiscalYear, status: "CLOSED" } as never);
    vi.mocked(prisma.fiscalYearClose.create).mockResolvedValue({ id: "fyc-loss" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearCloseService.closeFiscalYear(COMPANY_ID, YEAR, USER_ID);

    expect(result.totalRevenue.toString()).toBe("3000");
    expect(result.totalExpenses.toString()).toBe("8000");
    expect(result.netResult.toString()).toBe("-5000"); // pérdida
  });
});

describe("FiscalYearCloseService.appropriateFiscalYearResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTxMock();
  });

  it("throws if fiscal year is not closed", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);

    await expect(
      FiscalYearCloseService.appropriateFiscalYearResult(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`El ejercicio ${YEAR} no ha sido cerrado.`);
  });

  it("throws if appropriation already exists", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({
      id: "fyc-1",
      appropriationTransactionId: "tx-existing",
      netResult: new Decimal("4000"),
    } as never);

    await expect(
      FiscalYearCloseService.appropriateFiscalYearResult(COMPANY_ID, YEAR, USER_ID)
    ).rejects.toThrow(`El ejercicio ${YEAR} ya tiene asiento de apropiación registrado.`);
  });

  it("creates appropriation transaction and updates FiscalYearClose", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({
      id: "fyc-1",
      appropriationTransactionId: null,
      netResult: new Decimal("4000"),
    } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      resultAccountId: "account-result",
      retainedEarningsAccountId: "account-retained",
      retainedEarningsAccount: { id: "account-retained", type: "EQUITY", name: "Utilidades Retenidas" },
    } as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-approp-1" } as never);
    vi.mocked(prisma.fiscalYearClose.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearCloseService.appropriateFiscalYearResult(
      COMPANY_ID,
      YEAR,
      USER_ID
    );

    expect(result.appropriationTransactionId).toBe("tx-approp-1");
    expect(prisma.fiscalYearClose.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { appropriationTransactionId: "tx-approp-1" },
      })
    );
  });
});

describe("FiscalYearCloseService.getFiscalYearCloseHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no closes exist", async () => {
    vi.mocked(prisma.fiscalYearClose.findMany).mockResolvedValue([] as never);
    const result = await FiscalYearCloseService.getFiscalYearCloseHistory(COMPANY_ID);
    expect(result).toEqual([]);
  });

  it("maps Prisma records to FiscalYearCloseSummary with Decimal conversion", async () => {
    vi.mocked(prisma.fiscalYearClose.findMany).mockResolvedValue([
      {
        id: "fyc-1",
        year: 2024,
        closedAt: new Date("2025-01-15"),
        closedBy: "user-1",
        totalRevenue: new Decimal("50000"),
        totalExpenses: new Decimal("35000"),
        netResult: new Decimal("15000"),
        appropriationTransactionId: "tx-approp-1",
      },
    ] as never);

    const result = await FiscalYearCloseService.getFiscalYearCloseHistory(COMPANY_ID);

    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2024);
    expect(result[0].hasAppropriation).toBe(true);
    expect(result[0].netResult.toString()).toBe("15000");
  });
});
