// src/modules/payroll/__tests__/BenefitAccrualService.test.ts
// Fase NOM-D: Tests de BenefitAccrualService

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    benefitBalance: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    benefitAccrualLine: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    bcvBenefitRate: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    payrollConfig: {
      findUnique: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    payrollRunLine: {
      findMany: vi.fn(),
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

import { BenefitAccrualService } from "../services/BenefitAccrualService";
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
  vacationBonusDays: 7,
  benefitsExpenseAccountId: "acc-exp",
  benefitsPayableAccountId: "acc-pay",
  vacationPayableAccountId: "acc-vac",
  profitSharingPayableAccountId: "acc-profit",
  payableAccountId: "acc-salar",
  ivssPayableAccountId: "acc-ivss",
  expenseAccountId: "acc-exp2",
};

const BASE_PERIOD = {
  id: "period-1",
  companyId: COMPANY,
  year: 2026,
  month: 3,
  status: "OPEN" as const,
};

const BASE_BALANCE = {
  id: "bal-1",
  companyId: COMPANY,
  employeeId: EMP_ID,
  currentBalance: new Decimal("0"),
  interestBalance: new Decimal("0"),
  initialBalance: new Decimal("0"),
  initialInterestBalance: new Decimal("0"),
  isLiquidated: false,
  liquidatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_EMPLOYEE = {
  id: EMP_ID,
  companyId: COMPANY,
  firstName: "Juan",
  lastName: "Pérez",
  status: "ACTIVE" as const,
  hireDate: new Date("2025-01-01"),
  salaryHistory: [
    {
      id: "sal-1",
      effectiveFrom: new Date("2025-01-01"),
      amount: new Decimal("3000"),
      currency: "VES" as const,
    },
  ],
  benefitBalance: null,
};

describe("BenefitAccrualService.getOrCreateBalance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns existing balance if found", async () => {
    vi.mocked(prisma.benefitBalance.findUnique).mockResolvedValue(BASE_BALANCE as never);

    const result = await BenefitAccrualService.getOrCreateBalance(COMPANY, EMP_ID);
    expect(result.id).toBe("bal-1");
    expect(prisma.benefitBalance.create).not.toHaveBeenCalled();
  });

  it("creates new balance if not found", async () => {
    vi.mocked(prisma.benefitBalance.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.benefitBalance.create).mockResolvedValue(BASE_BALANCE as never);

    const result = await BenefitAccrualService.getOrCreateBalance(COMPANY, EMP_ID);
    expect(result.id).toBe("bal-1");
    expect(prisma.benefitBalance.create).toHaveBeenCalledOnce();
  });
});

describe("BenefitAccrualService.getBalance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null if no balance exists", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(null);

    const result = await BenefitAccrualService.getBalance(COMPANY, EMP_ID);
    expect(result).toBeNull();
  });

  it("returns balance with serialized lines", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue({
      ...BASE_BALANCE,
      accrualLines: [],
    } as never);

    const result = await BenefitAccrualService.getBalance(COMPANY, EMP_ID);
    expect(result).not.toBeNull();
    expect(result!.currentBalance).toBe("0");
    expect(result!.lines).toHaveLength(0);
  });

  it("IDOR: uses companyId in findFirst", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(null);

    await BenefitAccrualService.getBalance(COMPANY, EMP_ID);
    expect(vi.mocked(prisma.benefitBalance.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) })
    );
  });
});

describe("BenefitAccrualService.accrueQuarter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(BASE_PERIOD as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never); // sin conceptos integrales por defecto
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.benefitAccrualLine.create).mockResolvedValue({} as never);
    vi.mocked(prisma.benefitBalance.update).mockResolvedValue(BASE_BALANCE as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.benefitBalance.create).mockResolvedValue(BASE_BALANCE as never);
  });

  it("throws if quarter out of range", async () => {
    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 5)
    ).rejects.toThrow("El trimestre debe ser entre 1 y 4");
  });

  it("throws if accounting period closed", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1)
    ).rejects.toThrow("No hay período contable abierto para");
  });

  it("throws if payroll config missing", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null);

    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1)
    ).rejects.toThrow("Configure la nómina");
  });

  it("throws if benefit accounts not configured", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ...BASE_CONFIG,
      benefitsExpenseAccountId: null,
    } as never);

    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1)
    ).rejects.toThrow("Configure las cuentas contables");
  });

  it("throws if no active employees", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);

    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1)
    ).rejects.toThrow("No hay empleados activos");
  });

  it("calculates accrual correctly (5 días base + 0.5 adicionales por antigüedad × salario integral)", async () => {
    // BASE_EMPLOYEE.hireDate = 2025-01-01; Q1-2026 end = 2026-03-31 → ~1.24 years → 1 completed → +2/año → 0.5/trim
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{ ...BASE_EMPLOYEE }] as never);

    const result = await BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1);
    expect(result.employeesProcessed).toBe(1);

    // dailyNormal = 3000/30 = 100
    // profitAliq  = 100 * 15 / 360 = 4.1667
    // bonusAliq   = 100 * 7  / 360 = 1.9444
    // integral    = 106.1111
    // totalDays   = 5 (base) + 0.5 (1 año antigüedad) = 5.5
    // accrual     = 106.1111 × 5.5 = 583.6111
    const accrued = new Decimal(result.totalAccrued);
    expect(accrued.gte("583")).toBe(true);
    expect(accrued.lte("584")).toBe(true);
  });

  it("calculates accrual with 0 additional days for employee under 1 year", async () => {
    const recentEmployee = {
      ...BASE_EMPLOYEE,
      hireDate: new Date("2026-01-15"), // less than 1 year at Q1-2026 end
    };
    vi.mocked(prisma.employee.findMany).mockResolvedValue([recentEmployee] as never);

    const result = await BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1);
    expect(result.employeesProcessed).toBe(1);

    // 0 additional days → 5 days only → 106.1111 * 5 = 530.5556
    const accrued = new Decimal(result.totalAccrued);
    expect(accrued.gte("530")).toBe(true);
    expect(accrued.lte("531")).toBe(true);
  });

  it("double-accrual guard: skips P2002 and continues batch", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { ...BASE_EMPLOYEE, id: "emp-1" },
      { ...BASE_EMPLOYEE, id: "emp-2" },
    ] as never);

    // First employee throws P2002 (already accrued), second succeeds
    let callCount = 0;
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: typeof prisma) => unknown) => {
        callCount++;
        if (callCount === 1) {
          const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "5.0",
          });
          throw err;
        }
        return fn(prisma);
      }) as never
    );

    const result = await BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1);
    expect(result.employeesProcessed).toBe(1); // only second employee processed
  });

  it("throws if ALL employees already accrued (processed === 0)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{ ...BASE_EMPLOYEE }] as never);

    vi.mocked(prisma.$transaction).mockImplementation(() => {
      const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "5.0",
      });
      throw err;
    });

    await expect(
      BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1)
    ).rejects.toThrow("Ya existe una acumulación");
  });

  it("incluye conceptos salariales (affectsSalaryIntegral=true) en el salario integral — regresión ítem 56", async () => {
    // BASE_EMPLOYEE: salario 3000, hireDate 2025-01-01 → 1+ año → 5.5 días totales
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{ ...BASE_EMPLOYEE }] as never);

    // 3 corridas de nómina en el trimestre: bono salarial 300 cada una → total 900
    // avgMonthlyIntegralConcepts = 900 / 3 = 300
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: EMP_ID, amount: new Decimal("300") },
      { employeeId: EMP_ID, amount: new Decimal("300") },
      { employeeId: EMP_ID, amount: new Decimal("300") },
    ] as never);

    const result = await BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1);
    expect(result.employeesProcessed).toBe(1);

    // dailyNormal = (3000 + 300) / 30 = 110
    // profitAliq  = 110 * 15 / 360 = 4.5833
    // bonusAliq   = 110 * 7  / 360 = 2.1389
    // integral    = 116.7222
    // totalDays   = 5.5
    // accrual     = 116.7222 × 5.5 ≈ 641.97
    const accrued = new Decimal(result.totalAccrued);
    expect(accrued.gte("641")).toBe(true);
    expect(accrued.lte("643")).toBe(true);

    // Verificar que se consultó payrollRunLine con affectsSalaryIntegral=true
    expect(vi.mocked(prisma.payrollRunLine.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          concept: { affectsSalaryIntegral: true },
          conceptType: "EARNING",
        }),
      })
    );
  });

  it("empleado sin conceptos integrales usa solo salario base (sin regresión)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{ ...BASE_EMPLOYEE }] as never);
    // payrollRunLine.findMany ya devuelve [] por defecto en beforeEach

    const result = await BenefitAccrualService.accrueQuarter(COMPANY, USER, 2026, 1);

    // Igual que el test original: dailyNormal = 3000/30 = 100
    const accrued = new Decimal(result.totalAccrued);
    expect(accrued.gte("583")).toBe(true);
    expect(accrued.lte("584")).toBe(true);
  });
});

describe("BenefitAccrualService.postBenefitInterest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(BASE_PERIOD as never);
    vi.mocked(prisma.bcvBenefitRate.findUnique).mockResolvedValue({
      id: "bcv-1",
      companyId: COMPANY,
      year: 2026,
      month: 3,
      annualRate: new Decimal("24"),
      source: "BCV",
    } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.benefitBalance.findMany).mockResolvedValue([
      { ...BASE_BALANCE, currentBalance: new Decimal("1000"), interestBalance: new Decimal("0") },
    ] as never);
    vi.mocked(prisma.benefitAccrualLine.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-2" } as never);
    vi.mocked(prisma.benefitAccrualLine.create).mockResolvedValue({} as never);
    vi.mocked(prisma.benefitBalance.update).mockResolvedValue(BASE_BALANCE as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("throws if month out of range", async () => {
    await expect(
      BenefitAccrualService.postBenefitInterest(COMPANY, USER, 2026, 13)
    ).rejects.toThrow("El mes debe ser entre 1 y 12");
  });

  it("throws if no BCV rate registered — CRITICAL-3: rate never from client", async () => {
    vi.mocked(prisma.bcvBenefitRate.findUnique).mockResolvedValue(null);

    await expect(
      BenefitAccrualService.postBenefitInterest(COMPANY, USER, 2026, 3)
    ).rejects.toThrow("No existe tasa BCV registrada");
  });

  it("calculates monthly interest correctly (24% anual / 12)", async () => {
    const result = await BenefitAccrualService.postBenefitInterest(COMPANY, USER, 2026, 3);
    expect(result.employeesProcessed).toBe(1);

    // 1000 * (24/100/12) = 1000 * 0.02 = 20
    const interest = new Decimal(result.totalInterest);
    expect(interest.toFixed(2)).toBe("20.00");
  });

  it("skips balances with zero balance", async () => {
    vi.mocked(prisma.benefitBalance.findMany).mockResolvedValue([
      { ...BASE_BALANCE, currentBalance: new Decimal("0"), interestBalance: new Decimal("0") },
    ] as never);

    const result = await BenefitAccrualService.postBenefitInterest(COMPANY, USER, 2026, 3);
    expect(result.employeesProcessed).toBe(0);
    expect(result.totalInterest).toBe("0.0000");
  });
});

describe("BenefitAccrualService.backfillAllQuarters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(BASE_PERIOD as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(BASE_CONFIG as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-bf" } as never);
    vi.mocked(prisma.benefitAccrualLine.create).mockResolvedValue({} as never);
    vi.mocked(prisma.benefitBalance.update).mockResolvedValue(BASE_BALANCE as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.benefitBalance.create).mockResolvedValue(BASE_BALANCE as never);
  });

  it("throws if no open period", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    await expect(
      BenefitAccrualService.backfillAllQuarters(COMPANY, USER)
    ).rejects.toThrow("No hay período contable abierto");
  });

  it("throws if benefit accounts not configured", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ...BASE_CONFIG,
      benefitsExpenseAccountId: null,
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    await expect(
      BenefitAccrualService.backfillAllQuarters(COMPANY, USER)
    ).rejects.toThrow("Configure las cuentas contables");
  });

  it("skips employees without salary history", async () => {
    const emp = { ...BASE_EMPLOYEE, salaryHistory: [], benefitBalance: null };
    vi.mocked(prisma.employee.findMany).mockResolvedValue([emp] as never);

    const result = await BenefitAccrualService.backfillAllQuarters(COMPANY, USER);
    expect(result.employeesProcessed).toBe(0);
    expect(result.quartersProcessed).toBe(0);
  });

  it("no procesa trimestres futuros (empleado contratado el año siguiente)", async () => {
    // Si el empleado fue contratado el año próximo, no hay trimestres históricos a procesar
    const nextYear = new Date().getFullYear() + 1;
    const emp = {
      ...BASE_EMPLOYEE,
      hireDate: new Date(`${nextYear}-01-01`),
      benefitBalance: null,
    };
    vi.mocked(prisma.employee.findMany).mockResolvedValue([emp] as never);

    const result = await BenefitAccrualService.backfillAllQuarters(COMPANY, USER);
    expect(result.quartersProcessed).toBe(0);
    expect(result.employeesProcessed).toBe(0);
    expect(vi.mocked(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("procesa trimestres faltantes para empleado sin balance previo (ADR-015)", async () => {
    // Empleado contratado en el trimestre actual — debe procesar al menos 1 trimestre
    const now = new Date();
    const currentYear = now.getFullYear();
    const emp = {
      ...BASE_EMPLOYEE,
      hireDate: new Date(`${currentYear}-01-01`),
      benefitBalance: null,
    };
    vi.mocked(prisma.employee.findMany).mockResolvedValue([emp] as never);

    const result = await BenefitAccrualService.backfillAllQuarters(COMPANY, USER);
    expect(result.employeesProcessed).toBe(1);
    expect(result.quartersProcessed).toBeGreaterThanOrEqual(1);
    // Verifica que postea al período activo (ADR-015)
    expect(vi.mocked(prisma.transaction.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ periodId: BASE_PERIOD.id }),
      })
    );
  });
});

describe("BenefitAccrualService.createBcvRate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates BCV rate", async () => {
    vi.mocked(prisma.bcvBenefitRate.create).mockResolvedValue({
      id: "bcv-1",
      companyId: COMPANY,
      year: 2026,
      month: 3,
      annualRate: new Decimal("24"),
      source: "BCV",
      createdByUserId: USER,
      createdAt: new Date(),
    } as never);

    const result = await BenefitAccrualService.createBcvRate(COMPANY, USER, 2026, 3, 24);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.annualRate).toBe("24");
  });
});

// ─── F-05: getQuarterlyHistory — salario integral histórico por trimestre ──────

describe("BenefitAccrualService.getQuarterlyHistory (F-05)", () => {
  beforeEach(() => vi.clearAllMocks());

  const QUARTERLY_LINE = {
    id: "line-q1",
    type: "QUARTERLY_ACCRUAL",
    year: 2026,
    quarter: 1,
    month: null,
    accrualAmount: new Decimal("1500.0000"),
    runningBalance: new Decimal("1500.0000"),
    dailyNormalWage: new Decimal("100.0000"),
    profitDaysAliquot: new Decimal("4.1667"),
    vacationBonusDaysAliquot: new Decimal("1.9444"),
    integralDailyWage: new Decimal("106.1111"),
    accrualDays: 5,
    additionalDays: new Decimal("0"),
    appliedRate: null,
    transactionId: "tx-q1",
    createdAt: new Date("2026-03-31"),
    createdByUserId: "user-1",
    companyId: COMPANY,
    benefitBalanceId: "bal-1",
    bcvRateId: null,
  };

  it("returns empty array when employee has no balance", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(null);

    const result = await BenefitAccrualService.getQuarterlyHistory(COMPANY, EMP_ID);
    expect(result).toHaveLength(0);
  });

  it("returns QUARTERLY_ACCRUAL lines with full aliquot detail (F-05)", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(BASE_BALANCE as never);
    vi.mocked(prisma.benefitAccrualLine.findMany).mockResolvedValue([QUARTERLY_LINE] as never);

    const result = await BenefitAccrualService.getQuarterlyHistory(COMPANY, EMP_ID);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("QUARTERLY_ACCRUAL");
    expect(result[0].year).toBe(2026);
    expect(result[0].quarter).toBe(1);
    // F-05: alícuotas detalladas deben estar presentes
    expect(result[0].dailyNormalWage).toBe("100");
    expect(result[0].profitDaysAliquot).toBe("4.1667");
    expect(result[0].vacationBonusDaysAliquot).toBe("1.9444");
    expect(result[0].integralDailyWage).toBe("106.1111");
    expect(result[0].accrualDays).toBe(5);
  });

  it("queries only QUARTERLY_ACCRUAL lines ordered by year+quarter", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(BASE_BALANCE as never);
    vi.mocked(prisma.benefitAccrualLine.findMany).mockResolvedValue([]);

    await BenefitAccrualService.getQuarterlyHistory(COMPANY, EMP_ID);

    expect(vi.mocked(prisma.benefitAccrualLine.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "QUARTERLY_ACCRUAL" }),
        orderBy: [{ year: "asc" }, { quarter: "asc" }],
      })
    );
  });

  it("IDOR: verifica benefitBalance con companyId antes de retornar líneas", async () => {
    vi.mocked(prisma.benefitBalance.findFirst).mockResolvedValue(null);

    await BenefitAccrualService.getQuarterlyHistory("other-company", EMP_ID);

    // No debe consultar líneas si el balance no pertenece a la empresa
    expect(vi.mocked(prisma.benefitAccrualLine.findMany)).not.toHaveBeenCalled();
  });
});
