// src/modules/payroll/__tests__/TerminationService.test.ts
// Fase NOM-D: Tests de TerminationService

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    employee: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    termination: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    benefitBalance: {
      update: vi.fn(),
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

import { TerminationService } from "../services/TerminationService";
import Decimal from "decimal.js";

const COMPANY = "company-1";
const USER = "user-1";
const EMP_ID = "emp-1";
const TERM_ID = "term-1";

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
}

const BASE_CONFIG = {
  id: "cfg-1",
  companyId: COMPANY,
  profitDays: 15,
  vacationBonusDays: 7,
  benefitsExpenseAccountId: "acc-exp",
  benefitsPayableAccountId: "acc-ben",
  vacationPayableAccountId: "acc-vac",
  profitSharingPayableAccountId: "acc-profit",
  payableAccountId: "acc-pay",
  ivssPayableAccountId: "acc-ivss",
};

const BASE_EMPLOYEE = {
  id: EMP_ID,
  companyId: COMPANY,
  firstName: "Luis",
  lastName: "Rodríguez",
  status: "ACTIVE" as const,
  hireDate: new Date("2024-01-01"),
  salaryHistory: [
    { id: "sal-1", amount: new Decimal("3000"), effectiveFrom: new Date("2024-01-01") },
  ],
  benefitBalance: null,
};

const BASE_TERMINATION = {
  id: TERM_ID,
  companyId: COMPANY,
  employeeId: EMP_ID,
  reason: "RESIGNATION" as const,
  status: "DRAFT" as const,
  terminationDate: new Date("2026-04-16"),
  benefitBalanceId: null,
  benefitsAccumulatedAmount: new Decimal("0"),
  benefitsInterestAmount: new Decimal("0"),
  vacationFractionalDays: new Decimal("5"),
  vacationFractionalAmount: new Decimal("500"),
  vacationBonusFractionalAmount: new Decimal("200"),
  profitSharingFractionalDays: new Decimal("3.75"),
  profitSharingFractionalAmount: new Decimal("375"),
  profitSharingBaseSalary: new Decimal("3000"),
  indemnificationAmount: new Decimal("0"),
  pendingConceptsAmount: new Decimal("0"),
  pendingConceptsNotes: null,
  totalGrossAmount: new Decimal("1075"),
  deductionsAmount: new Decimal("0"),
  totalNetAmount: new Decimal("1075"),
  transactionId: null,
  idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  createdByUserId: USER,
  finalizedByUserId: null,
  finalizedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CREATE_INPUT = {
  reason: "RESIGNATION" as const,
  terminationDate: "2026-04-16",
  idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
};

describe("TerminationService.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(BASE_EMPLOYEE as never);
    vi.mocked(prisma.termination.findFirst).mockResolvedValue(null); // no existing FINALIZED
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.salaryHistory.findMany).mockResolvedValue(
      BASE_EMPLOYEE.salaryHistory as never
    );
    vi.mocked(prisma.termination.create).mockResolvedValue(BASE_TERMINATION as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("IDOR: throws if employee not found in company", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

    await expect(
      TerminationService.create(COMPANY, USER, EMP_ID, CREATE_INPUT)
    ).rejects.toThrow("Empleado no encontrado");
  });

  it("throws if employee is TERMINATED", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      status: "TERMINATED",
    } as never);

    await expect(
      TerminationService.create(COMPANY, USER, EMP_ID, CREATE_INPUT)
    ).rejects.toThrow("estado ACTIVO");
  });

  it("throws if FINALIZED termination already exists", async () => {
    // First findFirst = employee, second findFirst = existing termination
    vi.mocked(prisma.termination.findFirst).mockResolvedValue({
      ...BASE_TERMINATION,
      status: "FINALIZED",
    } as never);

    await expect(
      TerminationService.create(COMPANY, USER, EMP_ID, CREATE_INPUT)
    ).rejects.toThrow("ya tiene una liquidación final registrada");
  });

  it("computes DISMISSAL_UNJUSTIFIED indemnification = benefits accumulated", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      benefitBalance: {
        id: "bal-1",
        currentBalance: new Decimal("5000"),
        interestBalance: new Decimal("200"),
      },
    } as never);
    // Use full BASE_TERMINATION so serializeTermination doesn't fail
    vi.mocked(prisma.termination.create).mockResolvedValue(BASE_TERMINATION as never);

    await TerminationService.create(COMPANY, USER, EMP_ID, {
      ...CREATE_INPUT,
      reason: "DISMISSAL_UNJUSTIFIED",
    });

    // indemnificationAmount should = benefitsAccumulated + interest = 5200
    expect(vi.mocked(prisma.termination.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          indemnificationAmount: "5200.0000",
        }),
      })
    );
  });

  it("RESIGNATION has zero indemnification", async () => {
    await TerminationService.create(COMPANY, USER, EMP_ID, CREATE_INPUT);

    expect(vi.mocked(prisma.termination.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          indemnificationAmount: "0.0000",
        }),
      })
    );
  });

  it("idempotency key duplicate → P2002 → friendly error", async () => {
    const { Prisma } = require("@prisma/client");
    vi.mocked(prisma.termination.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0",
      })
    );

    await expect(
      TerminationService.create(COMPANY, USER, EMP_ID, CREATE_INPUT)
    ).rejects.toThrow("idempotencia");
  });
});

describe("TerminationService.finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.termination.findFirst).mockResolvedValue(BASE_TERMINATION as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1",
      year: 2026,
      month: 4,
      status: "OPEN",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.termination.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.employee.update).mockResolvedValue({} as never);
    vi.mocked(prisma.termination.update).mockResolvedValue({
      ...BASE_TERMINATION,
      status: "FINALIZED",
      transactionId: "tx-1",
      finalizedByUserId: USER,
      finalizedAt: new Date(),
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("IDOR: throws if termination not found in company", async () => {
    vi.mocked(prisma.termination.findFirst).mockResolvedValue(null);

    await expect(
      TerminationService.finalize(COMPANY, USER, TERM_ID)
    ).rejects.toThrow("Liquidación no encontrada");
  });

  it("throws if already FINALIZED", async () => {
    vi.mocked(prisma.termination.findFirst).mockResolvedValue({
      ...BASE_TERMINATION,
      status: "FINALIZED",
    } as never);

    await expect(
      TerminationService.finalize(COMPANY, USER, TERM_ID)
    ).rejects.toThrow("ya fue finalizada");
  });

  it("throws if FINALIZING (in-progress)", async () => {
    vi.mocked(prisma.termination.findFirst).mockResolvedValue({
      ...BASE_TERMINATION,
      status: "FINALIZING",
    } as never);

    await expect(
      TerminationService.finalize(COMPANY, USER, TERM_ID)
    ).rejects.toThrow("en proceso de finalización");
  });

  it("double-finalization guard: updateMany count 0 → race condition error", async () => {
    vi.mocked(prisma.termination.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      TerminationService.finalize(COMPANY, USER, TERM_ID)
    ).rejects.toThrow("race condition");
  });

  it("returns FINALIZED termination row", async () => {
    const result = await TerminationService.finalize(COMPANY, USER, TERM_ID);
    expect(result.status).toBe("FINALIZED");
    expect(result.transactionId).toBe("tx-1");
  });

  it("updates employee status to TERMINATED", async () => {
    await TerminationService.finalize(COMPANY, USER, TERM_ID);
    expect(vi.mocked(prisma.employee.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "TERMINATED" }),
      })
    );
  });
});

describe("TerminationService.getById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null if not found", async () => {
    vi.mocked(prisma.termination.findFirst).mockResolvedValue(null);
    const result = await TerminationService.getById(COMPANY, TERM_ID);
    expect(result).toBeNull();
  });

  it("IDOR: uses companyId in findFirst", async () => {
    vi.mocked(prisma.termination.findFirst).mockResolvedValue(BASE_TERMINATION as never);
    await TerminationService.getById(COMPANY, TERM_ID);
    expect(vi.mocked(prisma.termination.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) })
    );
  });
});
