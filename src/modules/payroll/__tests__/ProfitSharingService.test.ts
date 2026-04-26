// src/modules/payroll/__tests__/ProfitSharingService.test.ts
// Fase NOM-D: Tests de ProfitSharingService

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    employee: {
      findFirst: vi.fn(),
    },
    profitSharingRecord: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    salaryHistory: {
      findMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    payrollConfig: {
      findUnique: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { ProfitSharingService } from "../services/ProfitSharingService";
import Decimal from "decimal.js";

const COMPANY = "company-1";
const USER = "user-1";
const EMP_ID = "emp-1";

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
}

const BASE_CONFIG = {
  id: "cfg-1",
  companyId: COMPANY,
  profitDays: 15,
  benefitsExpenseAccountId: "acc-exp",
  profitSharingPayableAccountId: "acc-profit",
};

const BASE_EMPLOYEE = {
  id: EMP_ID,
  companyId: COMPANY,
  firstName: "Carlos",
  lastName: "López",
  status: "ACTIVE",
  hireDate: new Date("2026-01-01"),
};

const BASE_SALARY_ROWS = [
  {
    id: "sal-1",
    employeeId: EMP_ID,
    companyId: COMPANY,
    effectiveFrom: new Date("2026-01-01"),
    amount: new Decimal("3000"),
    currency: "VES",
  },
];

const BASE_PERIOD = {
  id: "period-1",
  year: 2026,
  month: 4,
  status: "OPEN",
};

const BASE_RECORD = {
  id: "ps-1",
  companyId: COMPANY,
  employeeId: EMP_ID,
  fiscalYear: 2026,
  profitDays: new Decimal("15"),
  fractionalDays: new Decimal("4"),
  monthsWorked: 3,
  baseSalarySnapshot: new Decimal("3000"),
  profitAmount: new Decimal("600"),
  isFractional: true,
  transactionId: "tx-1",
  createdByUserId: USER,
  createdAt: new Date(),
};

describe("ProfitSharingService.calculate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(BASE_EMPLOYEE as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue(BASE_SALARY_ROWS as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(BASE_PERIOD as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.profitSharingRecord.create).mockResolvedValue(BASE_RECORD as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("IDOR: throws if employee not found in company", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

    await expect(
      ProfitSharingService.calculate(COMPANY, USER, EMP_ID, { fiscalYear: 2026, isFractional: true })
    ).rejects.toThrow("Empleado no encontrado");
  });

  it("throws if no payroll config", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null);

    await expect(
      ProfitSharingService.calculate(COMPANY, USER, EMP_ID, { fiscalYear: 2026 })
    ).rejects.toThrow("Configure la nómina");
  });

  it("throws if no salary history", async () => {
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue([]);

    await expect(
      ProfitSharingService.calculate(COMPANY, USER, EMP_ID, { fiscalYear: 2026 })
    ).rejects.toThrow("no tiene historial de salarios");
  });

  it("throws if zero complete months worked", async () => {
    // Employee hired just yesterday (0 complete months in fiscal year)
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      hireDate: new Date("2026-04-16"), // today
    } as never);

    await expect(
      ProfitSharingService.calculate(COMPANY, USER, EMP_ID, {
        fiscalYear: 2026,
        periodEnd: "2026-04-16",
      })
    ).rejects.toThrow("ningún mes completo");
  });

  it("profitDays comes from config DB — never from client", async () => {
    await ProfitSharingService.calculate(COMPANY, USER, EMP_ID, {
      fiscalYear: 2026,
      isFractional: true,
      periodEnd: "2026-04-01",
    });

    expect(vi.mocked(prisma.profitSharingRecord.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profitDays: "15.00", // from BASE_CONFIG.profitDays, not client
        }),
      })
    );
  });

  it("computes fractional days proportionally", async () => {
    // 3 months worked, 15 profit days → 15/12*3 = 3.75 days
    await ProfitSharingService.calculate(COMPANY, USER, EMP_ID, {
      fiscalYear: 2026,
      isFractional: true,
      periodStart: "2026-01-01",
      periodEnd: "2026-04-01",
    });

    expect(vi.mocked(prisma.profitSharingRecord.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fractionalDays: "3.75",
        }),
      })
    );
  });

  it("double-pay guard: P2002 → friendly error", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(() => {
      const { Prisma } = require("@prisma/client");
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0",
      });
    });

    await expect(
      ProfitSharingService.calculate(COMPANY, USER, EMP_ID, { fiscalYear: 2026 })
    ).rejects.toThrow(`Ya existe un registro de utilidades para el año fiscal 2026 de este empleado`);
  });

  it("returns serialized record", async () => {
    const result = await ProfitSharingService.calculate(COMPANY, USER, EMP_ID, {
      fiscalYear: 2026,
      isFractional: true,
      periodEnd: "2026-04-01",
    });
    expect(result.id).toBe("ps-1");
    expect(result.fiscalYear).toBe(2026);
    expect(result.isFractional).toBe(true);
  });
});

describe("ProfitSharingService.listByEmployee", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array if no records", async () => {
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([]);
    const result = await ProfitSharingService.listByEmployee(COMPANY, EMP_ID);
    expect(result).toHaveLength(0);
  });

  it("IDOR: uses companyId in findMany", async () => {
    vi.mocked(prisma.profitSharingRecord.findMany).mockResolvedValue([]);
    await ProfitSharingService.listByEmployee(COMPANY, EMP_ID);
    expect(vi.mocked(prisma.profitSharingRecord.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) })
    );
  });
});
