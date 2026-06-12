// src/modules/payroll/__tests__/employee.actions.test.ts
// Tests: NOM-B-01 (IDOR), NOM-B-02 (cédula duplicada), NOM-B-03 (salary audit),
//        NOM-B-04 (ADMIN_ONLY write / WRITERS read), Zod validation

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/ratelimit";

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user-test" }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  limiters: { fiscal: {} },
}));

vi.mock("../services/EmployeeService", () => ({
  EmployeeService: {
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    getSalaryHistory: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    terminate: vi.fn(),
    addSalary: vi.fn(),
    countActive: vi.fn().mockResolvedValue(0),
  },
}));

import { auth } from "@clerk/nextjs/server";
import { EmployeeService } from "../services/EmployeeService";
import {
  listEmployeesAction,
  createEmployeeAction,
  terminateEmployeeAction,
  addSalaryAction,
  getSalaryHistoryAction,
} from "../actions/employee.actions";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";
const EMP_ID = "emp-test";

const BASE_EMP_ROW = {
  id: EMP_ID,
  companyId: COMPANY_ID,
  firstName: "Ana",
  lastName: "García",
  fullName: "Ana García",
  cedulaType: "V",
  cedulaNumber: "12345678",
  cedula: "V-12345678",
  contractType: "INDEFINIDO" as const,
  employeeRegime: "POST_2012" as const,
  hireDate: "2024-01-15",
  terminationDate: null,
  status: "ACTIVE" as const,
  position: "Contadora",
  department: null,
  email: null,
  phone: null,
  bankName: null,
  bankAccount: null,
  costCenter: null,
  ivssNumber: null,
  banavihNumber: null,
  dependents: null,
  birthDate: null,
  workSchedule: null,
  maritalStatus: null,
  payrollWorkerType: "EMPLEADO" as const,
  contractEndDate: null,
  useFideicomiso: false,
  currentSalary: null,
  currentSalaryAmount: null,
  currentSalaryCurrency: null,
  updatedAt: new Date().toISOString(),
};

const VALID_CREATE_INPUT = {
  firstName: "Ana",
  lastName: "García",
  cedulaType: "V",
  cedulaNumber: "12345678",
  contractType: "INDEFINIDO",
  employeeRegime: "POST_2012",
  hireDate: "2024-01-15",
  position: "Contadora",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);
});

// ─── listEmployeesAction ─────────────────────────────────────────────────────

describe("listEmployeesAction", () => {
  it("ADMIN — returns employee list", async () => {
    vi.mocked(EmployeeService.list).mockResolvedValue([BASE_EMP_ROW]);
    const result = await listEmployeesAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });

  it("ACCOUNTANT — can read (WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(EmployeeService.list).mockResolvedValue([]);
    const result = await listEmployeesAction(COMPANY_ID);
    expect(result.success).toBe(true);
  });

  it("no userId → No autorizado (NOM-B-01)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await listEmployeesAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("no membership → No autorizado (NOM-B-01 IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listEmployeesAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("VIEWER → Acceso denegado (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await listEmployeesAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Acceso denegado");
  });
});

// ─── createEmployeeAction ────────────────────────────────────────────────────

describe("createEmployeeAction", () => {
  it("ADMIN — creates employee successfully", async () => {
    vi.mocked(EmployeeService.create).mockResolvedValue(BASE_EMP_ROW);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cedula).toBe("V-12345678");
  });

  it("OWNER — creates employee successfully", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "OWNER" } as never);
    vi.mocked(EmployeeService.create).mockResolvedValue(BASE_EMP_ROW);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
  });

  it("no userId → No autorizado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
  });

  it("no membership → No autorizado (NOM-B-01)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
  });

  it("ACCOUNTANT → solo administrador puede registrar (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Administrador");
  });

  it("ADMINISTRATIVE → solo administrador puede registrar (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ADMINISTRATIVE",
    } as never);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
  });

  it("rate limit bloqueado → error", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas");
  });

  it("invalid hireDate → Zod error", async () => {
    const result = await createEmployeeAction(COMPANY_ID, {
      ...VALID_CREATE_INPUT,
      hireDate: "not-a-date",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ingreso");
  });

  it("invalid cedulaNumber (too short) → Zod error (NOM-B-02 client)", async () => {
    const result = await createEmployeeAction(COMPANY_ID, {
      ...VALID_CREATE_INPUT,
      cedulaNumber: "123",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("cédula");
  });

  it("P2002 → cédula duplicada en BD (NOM-B-02)", async () => {
    vi.mocked(EmployeeService.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.0.0" })
    );
    const result = await createEmployeeAction(COMPANY_ID, VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("cédula");
  });
});

// ─── terminateEmployeeAction ─────────────────────────────────────────────────

describe("terminateEmployeeAction", () => {
  it("ADMIN — terminates employee", async () => {
    vi.mocked(EmployeeService.terminate).mockResolvedValue({
      ...BASE_EMP_ROW,
      status: "TERMINATED",
      terminationDate: "2024-12-31",
    });
    const result = await terminateEmployeeAction(COMPANY_ID, EMP_ID, {
      terminationDate: "2024-12-31",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("TERMINATED");
  });

  it("ACCOUNTANT → sin permiso de egreso (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await terminateEmployeeAction(COMPANY_ID, EMP_ID, {
      terminationDate: "2024-12-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("egreso");
  });

  it("invalid terminationDate → Zod error", async () => {
    const result = await terminateEmployeeAction(COMPANY_ID, EMP_ID, {
      terminationDate: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

// ─── addSalaryAction ─────────────────────────────────────────────────────────

describe("addSalaryAction", () => {
  const SALARY_ENTRY = {
    id: "sal-1",
    effectiveFrom: "2024-01-15",
    amount: "5000",
    currency: "VES" as const,
    createdAt: new Date().toISOString(),
  };

  it("ADMIN — adds salary entry (NOM-B-03)", async () => {
    vi.mocked(EmployeeService.addSalary).mockResolvedValue(SALARY_ENTRY);
    const result = await addSalaryAction(COMPANY_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "5000",
      currency: "VES",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("5000");
  });

  it("ACCOUNTANT → solo administrador puede modificar salarios (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const result = await addSalaryAction(COMPANY_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "5000",
      currency: "VES",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("salarios");
  });

  it("invalid amount (negative) → Zod error", async () => {
    const result = await addSalaryAction(COMPANY_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "-500",
      currency: "VES",
    });
    expect(result.success).toBe(false);
  });

  it("no userId → No autorizado (NOM-B-01)", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const result = await addSalaryAction(COMPANY_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "5000",
      currency: "VES",
    });
    expect(result.success).toBe(false);
  });

  it("no membership → No autorizado (NOM-B-01 IDOR)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await addSalaryAction(COMPANY_ID, EMP_ID, {
      effectiveFrom: "2024-01-15",
      amount: "5000",
      currency: "VES",
    });
    expect(result.success).toBe(false);
  });
});

// ─── getSalaryHistoryAction ───────────────────────────────────────────────────

describe("getSalaryHistoryAction", () => {
  it("ACCOUNTANT — can read salary history (WRITERS)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(EmployeeService.getSalaryHistory).mockResolvedValue([]);
    const result = await getSalaryHistoryAction(COMPANY_ID, EMP_ID);
    expect(result.success).toBe(true);
  });

  it("VIEWER → Acceso denegado (NOM-B-04)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    const result = await getSalaryHistoryAction(COMPANY_ID, EMP_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Acceso denegado");
  });

  it("no membership → No autorizado (NOM-B-01)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await getSalaryHistoryAction(COMPANY_ID, EMP_ID);
    expect(result.success).toBe(false);
  });
});
