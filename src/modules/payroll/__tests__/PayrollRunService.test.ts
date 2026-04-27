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
  employeeCount: 1,
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
      { id: "c-sal", code: "SAL_BASE" },
      { id: "c-ivss", code: "IVSS_OBR" },
      { id: "c-inces", code: "INCES_OBR" },
      { id: "c-faov", code: "FAOV_OBR" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 4 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
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
      { id: "c-sal", code: "SAL_BASE" },
      { id: "c-ivss", code: "IVSS_OBR" },
    ] as never);
    vi.mocked(prisma.payrollRun.create).mockResolvedValue(BASE_RUN as never);
    vi.mocked(prisma.payrollRunLine.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollRunService.create(COMPANY_ID, USER_ID, INPUT);

    const createManyArg = vi.mocked(prisma.payrollRunLine.createMany).mock.calls[0]![0]!;
    const lines = createManyArg.data as Array<{ conceptCode: string; amount: Decimal }>;
    const ivssLine = lines.find((l) => l.conceptCode === "IVSS_OBR");
    expect(ivssLine).toBeDefined();
    // Sin tope: 1000×0.04=40. Con salaryMin=130 → tope=5×130=650 → 650×0.04=26
    expect(new Decimal(ivssLine!.amount.toString()).toFixed(2)).toBe("26.00");
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
      { id: "c-sal", code: "SAL_BASE" },
      { id: "c-rpe", code: "RPE_OBR" },
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
