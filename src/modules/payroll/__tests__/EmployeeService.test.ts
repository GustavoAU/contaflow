// src/modules/payroll/__tests__/EmployeeService.test.ts
// Tests: NOM-B EmployeeService — create/update/terminate/addSalary + AuditLog

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    employee: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    salaryHistory: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { EmployeeService } from "../services/EmployeeService";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";
const EMP_ID = "emp-test";

const BASE_EMPLOYEE = {
  id: EMP_ID,
  companyId: COMPANY_ID,
  firstName: "Ana",
  lastName: "García",
  cedulaType: "V",
  cedulaNumber: "12345678",
  contractType: "INDEFINIDO" as const,
  employeeRegime: "POST_2012" as const,
  hireDate: new Date("2024-01-15"),
  terminationDate: null,
  status: "ACTIVE" as const,
  position: "Contadora",
  department: "Administración",
  email: "ana@empresa.com",
  phone: null,
  bankName: null,
  bankAccount: null,
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date("2024-01-15"),
  salaryHistory: [],
};

const BASE_SALARY = {
  id: "sal-1",
  companyId: COMPANY_ID,
  employeeId: EMP_ID,
  effectiveFrom: new Date("2024-01-15"),
  amount: new Decimal("5000.00"),
  currency: "VES" as const,
  createdByUserId: USER_ID,
  createdAt: new Date("2024-01-15"),
};

// Interactive $transaction mock
function mockTx(overrides: Record<string, unknown> = {}) {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: unknown) => unknown) =>
      fn({
        employee: prisma.employee,
        salaryHistory: prisma.salaryHistory,
        auditLog: prisma.auditLog,
        ...overrides,
      })) as never
  );
}

beforeEach(() => vi.clearAllMocks());

// ─── list ─────────────────────────────────────────────────────────────────────

describe("EmployeeService.list", () => {
  it("returns empty list when no employees", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    const result = await EmployeeService.list(COMPANY_ID);
    expect(result).toEqual([]);
  });

  it("serializes employee list correctly", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { ...BASE_EMPLOYEE, salaryHistory: [BASE_SALARY] },
    ] as never);
    const result = await EmployeeService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].fullName).toBe("Ana García");
    expect(result[0].cedula).toBe("V-12345678");
    expect(result[0].currentSalaryAmount).toBe("5000");
    expect(result[0].currentSalaryCurrency).toBe("VES");
  });

  it("filters by status when provided", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
    await EmployeeService.list(COMPANY_ID, "ACTIVE");
    expect(vi.mocked(prisma.employee.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });
});

// ─── getById ─────────────────────────────────────────────────────────────────

describe("EmployeeService.getById", () => {
  it("returns null when not found", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);
    const result = await EmployeeService.getById(COMPANY_ID, EMP_ID);
    expect(result).toBeNull();
  });

  it("returns serialized employee", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [],
    } as never);
    const result = await EmployeeService.getById(COMPANY_ID, EMP_ID);
    expect(result).not.toBeNull();
    expect(result!.fullName).toBe("Ana García");
    expect(result!.currentSalary).toBeNull();
    expect(result!.hireDate).toBe("2024-01-15");
  });

  it("includes current salary from history", async () => {
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [BASE_SALARY],
    } as never);
    const result = await EmployeeService.getById(COMPANY_ID, EMP_ID);
    expect(result!.currentSalary).not.toBeNull();
    expect(result!.currentSalary!.amount).toBe("5000");
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("EmployeeService.create", () => {
  const CREATE_INPUT = {
    firstName: "Ana",
    lastName: "García",
    cedulaType: "V" as const,
    cedulaNumber: "12345678",
    contractType: "INDEFINIDO" as const,
    employeeRegime: "POST_2012" as const,
    hireDate: "2024-01-15",
    position: "Contadora",
    department: undefined,
    email: undefined,
    phone: undefined,
    bankName: undefined,
    bankAccount: undefined,
    initialSalaryAmount: undefined,
    initialSalaryCurrency: undefined,
  };

  it("creates employee and AuditLog with CREATE_EMPLOYEE action", async () => {
    mockTx();
    vi.mocked(prisma.employee.create).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [],
    } as never);
    vi.mocked(prisma.employee.findUniqueOrThrow).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await EmployeeService.create(COMPANY_ID, USER_ID, CREATE_INPUT);

    expect(result.fullName).toBe("Ana García");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATE_EMPLOYEE",
          oldValue: Prisma.JsonNull,
        }),
      })
    );
  });

  it("creates salary history when initialSalaryAmount provided", async () => {
    mockTx();
    vi.mocked(prisma.employee.create).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [],
    } as never);
    vi.mocked(prisma.employee.findUniqueOrThrow).mockResolvedValue({
      ...BASE_EMPLOYEE,
      salaryHistory: [BASE_SALARY],
    } as never);
    vi.mocked(prisma.salaryHistory.create).mockResolvedValue(BASE_SALARY as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await EmployeeService.create(COMPANY_ID, USER_ID, {
      ...CREATE_INPUT,
      initialSalaryAmount: "5000",
      initialSalaryCurrency: "VES",
    });

    expect(vi.mocked(prisma.salaryHistory.create)).toHaveBeenCalledTimes(1);
  });
});

// ─── terminate ────────────────────────────────────────────────────────────────

describe("EmployeeService.terminate", () => {
  it("sets status to TERMINATED and records AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(BASE_EMPLOYEE as never);
    vi.mocked(prisma.employee.update).mockResolvedValue({
      ...BASE_EMPLOYEE,
      status: "TERMINATED" as const,
      terminationDate: new Date("2024-12-31"),
      salaryHistory: [],
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await EmployeeService.terminate(COMPANY_ID, USER_ID, EMP_ID, {
      terminationDate: "2024-12-31",
    });

    expect(result.status).toBe("TERMINATED");
    expect(result.terminationDate).toBe("2024-12-31");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "TERMINATE_EMPLOYEE" }),
      })
    );
  });

  it("throws when employee already terminated", async () => {
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue({
      ...BASE_EMPLOYEE,
      status: "TERMINATED" as const,
    } as never);

    await expect(
      EmployeeService.terminate(COMPANY_ID, USER_ID, EMP_ID, { terminationDate: "2024-12-31" })
    ).rejects.toThrow("El empleado ya está egresado");
  });

  it("throws when employee not found", async () => {
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);

    await expect(
      EmployeeService.terminate(COMPANY_ID, USER_ID, EMP_ID, { terminationDate: "2024-12-31" })
    ).rejects.toThrow("Empleado no encontrado");
  });
});

// ─── addSalary ────────────────────────────────────────────────────────────────

describe("EmployeeService.addSalary", () => {
  it("creates SalaryHistory entry with AuditLog (NOM-B-03)", async () => {
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(BASE_EMPLOYEE as never);
    vi.mocked(prisma.salaryHistory.create).mockResolvedValue(BASE_SALARY as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await EmployeeService.addSalary(COMPANY_ID, USER_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "5000",
      currency: "VES",
    });

    expect(result.amount).toBe("5000");
    expect(result.currency).toBe("VES");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADD_SALARY",
          oldValue: Prisma.JsonNull,
        }),
      })
    );
  });

  it("throws when employee not found", async () => {
    mockTx();
    vi.mocked(prisma.employee.findFirst).mockResolvedValue(null as never);

    await expect(
      EmployeeService.addSalary(COMPANY_ID, USER_ID, EMP_ID, {
        effectiveFrom: "2024-01-15",
        amount: "5000",
        currency: "VES",
      })
    ).rejects.toThrow("Empleado no encontrado");
  });
});

// ─── countActive ──────────────────────────────────────────────────────────────

describe("EmployeeService.countActive", () => {
  it("returns count of active employees", async () => {
    vi.mocked(prisma.employee.count).mockResolvedValue(7 as never);
    const count = await EmployeeService.countActive(COMPANY_ID);
    expect(count).toBe(7);
    expect(vi.mocked(prisma.employee.count)).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, status: "ACTIVE" },
    });
  });
});
