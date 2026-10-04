// src/modules/payroll/__tests__/EmployeeLoanService.test.ts
// ADR-058 / SPEC-004: préstamos a empleados — montos al céntimo y asiento cuantizado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    employee: { findFirst: vi.fn() },
    employeeLoan: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    payrollConfig: { findUnique: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { EmployeeLoanService } from "../services/EmployeeLoanService";
import Decimal from "decimal.js";

const COMPANY = "company-1";
const USER = "user-1";
const EMP_ID = "emp-1";
const META = { ipAddress: "1.2.3.4", userAgent: "vitest" };

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma)) as never);
}

const LOAN_ROW = {
  id: "loan-12345678",
  companyId: COMPANY,
  employeeId: EMP_ID,
  totalAmount: new Decimal("1234.57"),
  currency: "VES",
  installments: 3,
  installmentAmount: new Decimal("411.53"),
  paidInstallments: 0,
  remainingBalance: new Decimal("1234.57"),
  amountUsd: null,
  installmentAmountUsd: null,
  remainingBalanceUsd: null,
  interestRate: null,
  status: "PENDING" as const,
  approvedByUserId: null,
  approvedAt: null,
  rejectionReason: null,
  description: null,
  createdByUserId: USER,
  createdAt: new Date("2026-04-01"),
  employee: { firstName: "Ana", lastName: "Pérez" },
};

describe("EmployeeLoanService.create — ADR-058", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      id: EMP_ID,
      firstName: "Ana",
      lastName: "Pérez",
    } as never);
    vi.mocked(prisma.employeeLoan.create).mockResolvedValue(LOAN_ROW as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("el principal se redondea a 2 decimales en el origen (1234,56789 -> 1234,57)", async () => {
    await EmployeeLoanService.create(
      COMPANY,
      { employeeId: EMP_ID, currency: "VES", totalAmount: "1234.56789", installments: 3 },
      USER,
      META
    );

    const data = vi.mocked(prisma.employeeLoan.create).mock.calls[0]![0]!.data as {
      totalAmount: Decimal;
      remainingBalance: Decimal;
      installmentAmount: Decimal;
    };
    expect(data.totalAmount.toFixed(4)).toBe("1234.5700");
    expect(data.remainingBalance.toFixed(4)).toBe("1234.5700");
    expect(data.installmentAmount.mul(100).isInteger()).toBe(true);
  });
});

describe("EmployeeLoanService.approve — ADR-058", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      loanReceivableAccountId: "acc-loan",
      disbursementBankAccountId: "acc-bank",
    } as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.employeeLoan.update).mockResolvedValue({
      ...LOAN_ROW,
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("un préstamo pendiente guardado a 4 decimales se asienta al céntimo y el asiento suma 0", async () => {
    vi.mocked(prisma.employeeLoan.findFirst).mockResolvedValue({
      ...LOAN_ROW,
      totalAmount: new Decimal("1234.5678"),
    } as never);

    await EmployeeLoanService.approve(COMPANY, "loan-12345678", USER, META);

    const data = vi.mocked(prisma.transaction.create).mock.calls[0]![0]!.data as {
      entries: { create: Array<{ accountId: string; amount: Decimal }> };
    };
    const lines = data.entries.create;
    expect(lines.map((e) => e.amount.toFixed(2))).toEqual(["1234.57", "-1234.57"]);
    expect(lines.reduce((s, e) => s.plus(e.amount), new Decimal(0)).isZero()).toBe(true);
    for (const e of lines) expect(Object.keys(e)).not.toContain("noAbsorb");
  });
});
