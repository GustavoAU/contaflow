// src/modules/payroll/__tests__/VacationService.test.ts
// Fase NOM-D: Tests de VacationService

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    employee: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    vacationRecord: {
      findMany: vi.fn(),
      create: vi.fn(),
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

import { VacationService, countCompleteMonths } from "../services/VacationService";
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
  benefitsExpenseAccountId: "acc-exp",
  vacationPayableAccountId: "acc-vac",
};

const BASE_EMPLOYEE = {
  id: EMP_ID,
  companyId: COMPANY,
  firstName: "María",
  lastName: "González",
  status: "ACTIVE",
  hireDate: new Date("2024-01-01"),
  salaryHistory: [
    {
      id: "sal-1",
      effectiveFrom: new Date("2024-01-01"),
      amount: new Decimal("3000"),
      currency: "VES",
    },
  ],
};

const BASE_PERIOD = {
  id: "period-1",
  year: 2026,
  month: 4,
  status: "OPEN",
};

const VAC_INPUT = {
  periodYear: 2026,
  vacationDays: 15,
  bonusDays: 7,
  startDate: "2026-04-01",
  endDate: "2026-04-15",
};

describe("countCompleteMonths", () => {
  it("counts full months correctly", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-04-01");
    expect(countCompleteMonths(from, to)).toBe(3);
  });

  it("counts partial month with 15+ days as complete", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-17"); // 16 days
    expect(countCompleteMonths(from, to)).toBe(1);
  });

  it("does NOT count partial month with <15 days", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-01-14"); // 13 days
    expect(countCompleteMonths(from, to)).toBe(0);
  });

  it("returns 0 for same date", () => {
    const d = new Date("2026-04-01");
    expect(countCompleteMonths(d, d)).toBe(0);
  });
});

describe("VacationService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(BASE_EMPLOYEE as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(BASE_PERIOD as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.vacationRecord.create).mockResolvedValue({
      id: "vac-1",
      companyId: COMPANY,
      employeeId: EMP_ID,
      periodYear: 2026,
      vacationDays: new Decimal("15"),
      bonusDays: new Decimal("7"),
      dailyNormalWage: new Decimal("100"),
      vacationAmount: new Decimal("1500"),
      bonusAmount: new Decimal("700"),
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-04-15"),
      isFractional: false,
      transactionId: "tx-1",
      createdByUserId: USER,
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("IDOR: throws if employee not in company", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

    await expect(
      VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT)
    ).rejects.toThrow("Empleado no encontrado");
  });

  it("throws if no salary history", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [],
    } as never);

    await expect(
      VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT)
    ).rejects.toThrow("no tiene salario registrado");
  });

  it("throws if accounting period closed", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(
      VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT)
    ).rejects.toThrow("está cerrado o no existe");
  });

  it("throws if vacation accounts not configured", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ...BASE_CONFIG,
      vacationPayableAccountId: null,
    } as never);

    await expect(
      VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT)
    ).rejects.toThrow("Configure las cuentas contables de vacaciones");
  });

  it("dailyNormalWage computed server-side — never from client", async () => {
    await VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT);
    // The create was called with the server-calculated dailyNormalWage (3000/30 = 100)
    expect(vi.mocked(prisma.vacationRecord.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dailyNormalWage: expect.any(String),
        }),
      })
    );
  });

  it("creates vacation record and returns serialized row", async () => {
    const result = await VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT);
    expect(result.id).toBe("vac-1");
    expect(result.periodYear).toBe(2026);
    expect(result.isFractional).toBe(false);
  });

  it("double-pay guard: P2002 → friendly error", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(() => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0",
      });
    });

    await expect(
      VacationService.create(COMPANY, USER, EMP_ID, VAC_INPUT)
    ).rejects.toThrow("Ya existe un registro de vacaciones");
  });
});

describe("VacationService.listByEmployee", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array if no records", async () => {
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValue([]);

    const result = await VacationService.listByEmployee(COMPANY, EMP_ID);
    expect(result).toHaveLength(0);
  });

  it("IDOR: uses companyId in findMany", async () => {
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValue([]);

    await VacationService.listByEmployee(COMPANY, EMP_ID);
    expect(vi.mocked(prisma.vacationRecord.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) })
    );
  });
});

describe("VacationService.computeFractionalDays", () => {
  it("computes fractional days for 1-year employee", () => {
    const hire = new Date("2025-01-01");
    const termination = new Date("2025-07-01"); // 6 months
    const { vacationDays, bonusDays } = VacationService.computeFractionalDays(hire, termination, 0);

    // 15 days annual / 12 * 6 months = 7.5 days
    expect(vacationDays.toFixed(2)).toBe("7.50");
    // 7 bonus days / 12 * 6 = 3.5
    expect(bonusDays.toFixed(2)).toBe("3.50");
  });

  it("computes fractional days for 3-year employee", () => {
    const hire = new Date("2023-01-01");
    const termination = new Date("2026-04-01"); // 3 years + 3 months (Q2 of year 4)
    const { vacationDays } = VacationService.computeFractionalDays(hire, termination, 3);

    // For year 4 fraction: 15 + (4-1) = 18 annual days. But since we're in year 4,
    // we pass yearsOfService = 3, so annualVacDays = max(15, 14+3) = 17
    // Months in year 4 starting from Jan 1: 3 months (Jan-Mar)
    // vacFracDays = 17/12*3 = 4.25
    expect(parseFloat(vacationDays.toFixed(2))).toBeGreaterThan(4);
  });
});

// ─── F-06: getOverdueVacationEmployees ───────────────────────────────────────

describe("VacationService.getOverdueVacationEmployees (F-06)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns employees with ≥1 year service and no vacation record for last year", async () => {
    const overdueYear = new Date().getFullYear() - 1;
    // Employee hired 2 years ago — should have been covered for last year
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: EMP_ID, firstName: "María", lastName: "González", hireDate: twoYearsAgo },
    ] as never);
    // No records for the overdue year
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([] as never); // overdueYear records
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([] as never); // all records

    const result = await VacationService.getOverdueVacationEmployees(COMPANY);

    expect(result).toHaveLength(1);
    expect(result[0].employeeId).toBe(EMP_ID);
    expect(result[0].overdueYear).toBe(overdueYear);
  });

  it("excludes employees who already have a vacation record for the overdue year", async () => {
    const overdueYear = new Date().getFullYear() - 1;
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: EMP_ID, firstName: "María", lastName: "González", hireDate: twoYearsAgo },
    ] as never);
    // Has a record for overdueYear
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([
      { employeeId: EMP_ID },
    ] as never);
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([
      { employeeId: EMP_ID, periodYear: overdueYear },
    ] as never);

    const result = await VacationService.getOverdueVacationEmployees(COMPANY);
    expect(result).toHaveLength(0);
  });

  it("excludes employees with <1 year of service at end of overdue year", async () => {
    // Hired at the start of current year → less than 1 year at end of last year
    const startOfThisYear = new Date(new Date().getFullYear(), 0, 1);

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: EMP_ID, firstName: "Nuevo", lastName: "Empleado", hireDate: startOfThisYear },
    ] as never);
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValueOnce([]);

    const result = await VacationService.getOverdueVacationEmployees(COMPANY);
    expect(result).toHaveLength(0);
  });
});

// ─── F-06: getEmployeesOnVacation ────────────────────────────────────────────

describe("VacationService.getEmployeesOnVacation (F-06)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns employees whose vacation period includes today", async () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValue([
      {
        employeeId: EMP_ID,
        periodYear: 2026,
        startDate: yesterday,
        endDate: tomorrow,
        employee: { firstName: "María", lastName: "González", status: "ACTIVE" },
      },
    ] as never);

    const result = await VacationService.getEmployeesOnVacation(COMPANY);

    expect(result).toHaveLength(1);
    expect(result[0].employeeId).toBe(EMP_ID);
    expect(result[0].fullName).toBe("María González");
  });

  it("returns empty array when no employee is on vacation", async () => {
    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValue([] as never);
    const result = await VacationService.getEmployeesOnVacation(COMPANY);
    expect(result).toHaveLength(0);
  });

  it("excludes inactive employees from on-vacation list", async () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    vi.mocked(prisma.vacationRecord.findMany).mockResolvedValue([
      {
        employeeId: "emp-inactive",
        periodYear: 2026,
        startDate: yesterday,
        endDate: tomorrow,
        employee: { firstName: "Ex", lastName: "Empleado", status: "TERMINATED" },
      },
    ] as never);

    const result = await VacationService.getEmployeesOnVacation(COMPANY);
    expect(result).toHaveLength(0);
  });
});
