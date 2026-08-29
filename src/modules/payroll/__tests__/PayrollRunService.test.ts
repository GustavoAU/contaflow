// src/modules/payroll/__tests__/PayrollRunService.test.ts
// Fase NOM-C: Tests del PayrollRunService (CRUD + estados + IDOR guard)

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("../services/PayrollConceptService", () => ({
  PayrollConceptService: {
    seedDefaults: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payrollRunLine: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    payrollConcept: {
      findMany: vi.fn(),
    },
    payrollConfig: {
      findUnique: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    legalThreshold: {
      findFirst: vi.fn(),
    },
    bcvBenefitRate: {
      findFirst: vi.fn(),
    },
    employeeLoan: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    exchangeRate: {
      findFirst: vi.fn(),
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

import { PayrollRunService } from "../services/PayrollRunService";
import { PayrollConceptService } from "../services/PayrollConceptService";
import Decimal from "decimal.js";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const RUN_ID = "run-1";

function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
}

const BASE_RUN = {
  id: RUN_ID,
  companyId: COMPANY_ID,
  periodStart: new Date("2026-04-01"),
  periodEnd: new Date("2026-04-15"),
  status: "DRAFT" as const,
  totalEarnings: new Decimal("30000"),
  totalDeductions: new Decimal("2100"),
  totalNet: new Decimal("27900"),
  totalEmployerCosts: new Decimal("0"),
  employeeCount: 1,
  bcvRateAtRun: null,
  transactionId: null,
  createdByUserId: USER_ID,
  approvedByUserId: null,
  cancelledByUserId: null,
  approvedAt: null,
  cancelledAt: null,
  idempotencyKey: "key-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("PayrollRunService.list", () => {
  it("returns serialized runs for company", async () => {
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([BASE_RUN] as never);
    const result = await PayrollRunService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(RUN_ID);
    expect(result[0].totalNet).toBe("27900");
    expect(vi.mocked(prisma.payrollRun.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });
});

// ─── getById — IDOR guard ─────────────────────────────────────────────────────

describe("PayrollRunService.getById", () => {
  it("returns null when run belongs to different company (IDOR guard)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    const result = await PayrollRunService.getById("other-company", RUN_ID);
    expect(result).toBeNull();
    expect(vi.mocked(prisma.payrollRun.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "other-company" }),
      })
    );
  });

  it("returns null when run does not exist", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    const result = await PayrollRunService.getById(COMPANY_ID, "nonexistent");
    expect(result).toBeNull();
  });
});

// ─── create — doble proceso (NOM-C-02) ───────────────────────────────────────

describe("PayrollRunService.create", () => {
  const INPUT = {
    periodStart: "2026-04-01",
    periodEnd: "2026-04-15",
    idempotencyKey: "key-test",
  };

  function setupCreateMocks() {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      id: "period-1", status: "OPEN",
    } as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null); // sin threshold → fallback a config
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true, incesEnabled: true, banavihEnabled: true, frequency: "MONTHLY",
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "emp-1",
        salaryHistory: [{ id: "sal-1", amount: new Decimal("30000"), currency: "VES", effectiveFrom: new Date("2026-01-01") }],
      },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-inces", code: "INCES_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null); // sin tasa BCV configurada
    // D-5: sin runs aprobados el mes anterior → el calculador cotiza sobre el
    // mes en curso. Los tests que fijan D-5 sobrescriben estos dos.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 4 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never); // sin préstamos activos
  }

  it("creates run with AuditLog in $transaction", async () => {
    setupCreateMocks();
    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);
    expect(result.id).toBe(RUN_ID);
    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalled();
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE_PAYROLL_RUN" }),
      })
    );
  });

  it("throws when no open accounting period (NOM-C-13)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ ivssEnabled: true, incesEnabled: true, banavihEnabled: true, frequency: "MONTHLY" } as never);
    await expect(
      PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)
    ).rejects.toThrow("No existe un período contable abierto");
  });

  it("throws when no payroll config", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "p1", status: "OPEN" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)
    ).rejects.toThrow("Configure la nómina");
  });

  it("throws when no active employees", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "p1", status: "OPEN" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({ ivssEnabled: true, incesEnabled: true, banavihEnabled: true, frequency: "MONTHLY" } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    await expect(
      PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)
    ).rejects.toThrow("No hay empleados activos");
  });

  it("aplica tope salario mínimo en IVSS cuando salaryMinimumVes > 0 — regresión ítem 55", async () => {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true, incesEnabled: false, banavihEnabled: false, rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: new Decimal("130"),
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{
      id: "emp-1",
      salaryHistory: [{ id: "sal-1", amount: new Decimal("1000"), currency: "VES", effectiveFrom: new Date("2026-01-01") }],
    }] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR");
    expect(ivssLine).toBeDefined();
    // Tope MENSUAL 5×130 = 650 (Reglamento Art. 98), llevado a las semanas que
    // cotiza esta quincena: el 1–15 de abril de 2026 tiene dos lunes (6 y 13).
    // 650 × 12/52 × 2 = 300 → 4% = 12. Antes cobraba el mes entero en cada
    // quincena, o sea dos veces la cotización del mes.
    expect(new Decimal(ivssLine!.amount.toString()).toFixed(2)).toBe("12.00");
  });

  // ── D-5: la base sale del mes anterior (LOTTT Art. 107) ────────────────────

  it("D-5: cotiza sobre el salario normal del mes anterior, no el del período", async () => {
    setupCreateMocks();
    // Marzo cerrado con 10.000 de salario normal; en abril gana 30.000.
    vi.mocked(prisma.payrollRun.findMany).mockResolvedValue([{ id: "run-mar" }] as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { employeeId: "emp-1", conceptCode: "SAL_BASE", amount: new Decimal("10000") },
      // Una HE del mes pasado NO forma parte del salario normal (Art. 104).
      { employeeId: "emp-1", conceptCode: "HE_DIURNA", amount: new Decimal("5000") },
    ] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-he", code: "HE_DIURNA", salaryNature: "SALARIAL_ACCIDENTAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-faov", code: "FAOV_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-rpe", code: "RPE_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    // Se paga el sueldo de abril…
    const sal = lines.find((l) => l.conceptCode === "SAL_BASE")!;
    expect(new Decimal((sal as unknown as { amount: Decimal }).amount.toString()).toFixed(2))
      .toBe("30000.00");
    // …pero se cotiza sobre los 10.000 de marzo, sin la hora extra.
    // El FAOV va sobre el integral de esa base: 10.000 x 1,125 = 11.250.
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    expect(new Decimal(faov.basis!.toString()).toFixed(2)).toBe("11250.00");
  });

  it("D-5: sin nómina aprobada el mes anterior usa el mes en curso", async () => {
    setupCreateMocks(); // payrollRun.findMany → []
    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; basis: Decimal | null }>;
    const faov = lines.find((l) => l.conceptCode === "FAOV_OBR")!;
    expect(new Decimal(faov.basis!.toString()).toFixed(2)).toBe("33750.00"); // 30.000 x 1,125
  });

  // ── H-4: el tope está en bolívares; el sueldo puede no estarlo ──────────────

  function setupUsdCapMocks() {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true, incesEnabled: false, banavihEnabled: false, rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: new Decimal("130"), // tope IVSS = Bs. 650
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{
      id: "emp-1",
      salaryHistory: [{ id: "sal-1", amount: new Decimal("2500"), currency: "USD", effectiveFrom: new Date("2026-01-01") }],
    }] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);
  }

  it("H-4: convierte el tope legal a dólares con la tasa de ExchangeRate", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({ rate: new Decimal("65") } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Tope Bs. 650 / 65 = USD 10, por las dos semanas de la quincena:
    // 10 × 12/52 × 2 = 4,62 → 4% = USD 0,18.
    // Antes del fix de H-4 salía 26,00: los bolívares del tope cobrados como
    // dólares. Lo que se comprueba aquí sigue siendo la conversión del tope.
    expect(new Decimal(ivssLine.amount.toString()).toFixed(2)).toBe("0.18");
  });

  it("H-4: busca la tasa USD de la empresa hasta el fin del período", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({ rate: new Decimal("65") } as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    // Misma ventana que usa approve() para el asiento — si divergen, el tope y el
    // asiento saldrían de tasas distintas.
    expect(vi.mocked(prisma.exchangeRate.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          currency: "USD",
          date: { lte: new Date(INPUT.periodEnd) },
        }),
      })
    );
  });

  it("H-4: sin tasa registrada no crea la nómina — bloquea en vez de inventar el tope", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await expect(
      PayrollRunService.create(COMPANY_ID, USER_ID, INPUT)
    ).rejects.toThrow("Nómina en USD: registra la tasa BCV USD/VES");

    expect(vi.mocked(prisma.payrollRun.create)).not.toHaveBeenCalled();
  });

  it("H-4: un sueldo en USD sin topes configurados no exige tasa", async () => {
    setupUsdCapMocks();
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: true, incesEnabled: false, banavihEnabled: false, rpeEnabled: false,
      frequency: "MONTHLY",
      salaryMinimumVes: null, // sin tope
    } as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR")!;
    // Sin tope, el sueldo entero por las dos semanas: 2500 × 12/52 × 2 = 1.153,85
    expect(new Decimal(ivssLine.amount.toString()).toFixed(2)).toBe("46.15");
  });

  it("C-05: almacena tasa BCV cuando existe BcvBenefitRate para el período", async () => {
    setupCreateMocks();
    vi.mocked(prisma.bcvBenefitRate.findFirst).mockResolvedValue({
      annualRate: new Decimal("17.50"),
    } as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue({
      ...BASE_RUN,
      bcvRateAtRun: new Decimal("17.50"),
    } as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bcvRateAtRun: expect.any(Decimal),
        }),
      })
    );
    expect(result.bcvRateAtRun).toBe("17.5");
  });

  it("F-03: almacena totalEmployerCosts calculado por PayrollCalculatorService", async () => {
    setupCreateMocks();
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-ivss", code: "IVSS_OBR", salaryNature: "NO_SALARIAL" },
      { id: "c-ivss-pat", code: "IVSS_PAT", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue({
      ...BASE_RUN,
      totalEmployerCosts: new Decimal("2700"), // 30000 × 9%
    } as never);

    const result = await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(prisma.payrollRun.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalEmployerCosts: expect.any(Decimal),
        }),
      })
    );
    expect(result.totalEmployerCosts).toBeDefined();
  });

  it("llama seedDefaults antes de calcular para garantizar RPE_OBR — regresión ítem 54", async () => {
    mockTx();
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1", status: "OPEN" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      ivssEnabled: false, incesEnabled: false, banavihEnabled: false, rpeEnabled: true,
      frequency: "MONTHLY", salaryMinimumVes: null,
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{
      id: "emp-1",
      salaryHistory: [{ id: "sal-1", amount: new Decimal("3000"), currency: "VES", effectiveFrom: new Date("2026-01-01") }],
    }] as never);
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([
      { id: "c-sal", code: "SAL_BASE", salaryNature: "SALARIO_NORMAL" },
      { id: "c-rpe", code: "RPE_OBR", salaryNature: "NO_SALARIAL" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    expect(vi.mocked(PayrollConceptService.seedDefaults)).toHaveBeenCalledWith(COMPANY_ID);
    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const rpeLine = lines.find((l) => l.conceptCode === "RPE_OBR");
    expect(rpeLine).toBeDefined();
    // Sin salaryMin: 3000×0.005=15
    expect(new Decimal(rpeLine!.amount.toString()).toFixed(2)).toBe("15.00");
  });
});

// ─── approve — mutex updateMany (NOM-C-03) ────────────────────────────────────

describe("PayrollRunService.approve", () => {
  function setupApproveMocks() {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: "acct-ivss",
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      ivssEnabled: true,
      incesEnabled: false,
      banavihEnabled: false,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "IVSS_OBR", conceptType: "DEDUCTION", amount: new Decimal("1200") },
    ] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-1" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({ ...BASE_RUN, status: "APPROVED", transactionId: "tx-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never); // sin préstamos activos
  }

  it("approves run with updateMany mutex and creates AuditLog (NOM-C-03, NOM-C-11)", async () => {
    setupApproveMocks();
    const result = await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);
    expect(result.status).toBe("APPROVED");
    expect(vi.mocked(prisma.payrollRun.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "DRAFT" }),
      })
    );
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "APPROVE_PAYROLL_RUN" }),
      })
    );
    expect(vi.mocked(prisma.transaction.create)).toHaveBeenCalled();
  });

  it("hallazgo #11: asiento GL usa run.periodEnd como fecha (no new Date())", async () => {
    setupApproveMocks();
    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    expect(txCall?.data?.date).toEqual(BASE_RUN.periodEnd);
  });

  it("throws when run already approved (updateMany returns count 0)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({ ...BASE_RUN, status: "APPROVED" } as never);
    await expect(
      PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)
    ).rejects.toThrow("ya fue aprobado");
  });

  it("throws when run not found (IDOR guard — NOM-C-01)", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.approve("other-company", USER_ID, RUN_ID)
    ).rejects.toThrow("no encontrado");
  });

  it("throws when accounts not configured", async () => {
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "p1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: null, payableAccountId: null,
      ivssPayableAccountId: null, faovPayableAccountId: null, incesPayableAccountId: null,
      ivssEnabled: true, incesEnabled: true, banavihEnabled: true,
    } as never);
    await expect(
      PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)
    ).rejects.toThrow("Configure las cuentas contables");
  });

  // V-1: descuadre GL patronal
  it("V-1: patronal debit equals sum of configured credits only (no ivssPatronalAccount)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      rpePayableAccountId: null,
      loanReceivableAccountId: null,
      ivssEnabled: false,
      incesEnabled: true,
      banavihEnabled: false,
      rpeEnabled: false,
      // INCES patronal configurado, IVSS NO
      ivssPatronalAccountId: null,
      incesPatronalAccountId: "acct-inces-pat",
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", conceptType: "EARNING", amount: new Decimal("1000"), salarySnapshotCurrency: "VES" },
      { conceptCode: "INCES_PAT", conceptType: "EMPLOYER_COST", amount: new Decimal("20"), salarySnapshotCurrency: "VES" },
    ] as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-v1" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({ ...BASE_RUN, status: "APPROVED", transactionId: "tx-v1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    type GL = { accountId: string; amount: Decimal; description: string };
    const entries = (txCall?.data?.entries?.create ?? []) as GL[];
    // El debit patronal tiene "aportes patronales" en la descripción — Bs. 20 (solo INCES configurado)
    const patronalDebit = entries.find((e) => e.description?.includes("aportes patronales"));
    const incesCredit = entries.find((e) => e.accountId === "acct-inces-pat");
    // Debit = 20 (solo INCES), crédito = -20 → asiento cuadrado
    expect(patronalDebit?.amount.toNumber()).toBe(20);
    expect(incesCredit?.amount.toNumber()).toBe(-20);
  });

  // V-2: conversión USD→VES en GL
  it("V-2: USD payroll amounts are converted to VES using exchange rate", async () => {
    mockTx();
    // Run con totalEarnings = $100 USD
    const USD_RUN = { ...BASE_RUN, totalEarnings: new Decimal("100"), totalDeductions: new Decimal("0"), totalNet: new Decimal("100") };
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(USD_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssPayableAccountId: null,
      faovPayableAccountId: null,
      incesPayableAccountId: null,
      rpePayableAccountId: null,
      loanReceivableAccountId: null,
      ivssEnabled: false,
      incesEnabled: false,
      banavihEnabled: false,
      rpeEnabled: false,
      ivssPatronalAccountId: null,
      incesPatronalAccountId: null,
      faovPatronalAccountId: null,
      rpePatronalAccountId: null,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", conceptType: "EARNING", amount: new Decimal("100"), salarySnapshotCurrency: "USD" },
    ] as never);
    // Tasa BCV: 1 USD = 40 Bs.
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue({ rate: new Decimal("40") } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-usd" } as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({ ...USD_RUN, status: "APPROVED", transactionId: "tx-usd" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.employeeLoan.findMany).mockResolvedValue([] as never);

    await PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID);

    const txCall = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    type GL = { accountId: string; amount: Decimal };
    const entries = (txCall?.data?.entries?.create ?? []) as GL[];
    const debitEntry = entries.find((e) => e.accountId === "acct-exp");
    // $100 × 40 = Bs. 4000
    expect(debitEntry?.amount.toNumber()).toBe(4000);
  });

  // V-2: USD sin tasa registrada → lanza error
  it("V-2: USD payroll throws when no exchange rate registered", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({ id: "period-1" } as never);
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue({
      expenseAccountId: "acct-exp",
      payableAccountId: "acct-pay",
      ivssEnabled: false, incesEnabled: false, banavihEnabled: false, rpeEnabled: false,
    } as never);
    vi.mocked(prisma.payrollRun.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.payrollRunLine.findMany).mockResolvedValue([
      { conceptCode: "SAL_BASE", conceptType: "EARNING", amount: new Decimal("100"), salarySnapshotCurrency: "USD" },
    ] as never);
    vi.mocked(prisma.exchangeRate.findFirst).mockResolvedValue(null as never);

    await expect(
      PayrollRunService.approve(COMPANY_ID, USER_ID, RUN_ID)
    ).rejects.toThrow("Nómina en USD: registra la tasa BCV USD/VES");
  });
});

// ─── cancel — solo DRAFT (NOM-C-04) ──────────────────────────────────────────

describe("PayrollRunService.cancel", () => {
  it("cancels DRAFT run with AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRun.update).mockResolvedValue({ ...BASE_RUN, status: "CANCELLED" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "Error en datos");
    expect(result.status).toBe("CANCELLED");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CANCEL_PAYROLL_RUN" }),
      })
    );
  });

  it("throws when trying to cancel APPROVED run (NOM-C-04)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...BASE_RUN, status: "APPROVED",
    } as never);
    await expect(
      PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "razón")
    ).rejects.toThrow("No se puede cancelar un proceso aprobado");
  });

  it("throws when trying to cancel CANCELLED run", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue({
      ...BASE_RUN, status: "CANCELLED",
    } as never);
    await expect(
      PayrollRunService.cancel(COMPANY_ID, USER_ID, RUN_ID, "razón")
    ).rejects.toThrow("ya está cancelado");
  });

  it("throws when run not found (IDOR guard)", async () => {
    mockTx();
    vi.mocked(prisma.payrollRun.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollRunService.cancel("other-company", USER_ID, RUN_ID, "razón")
    ).rejects.toThrow("no encontrado");
  });
});
