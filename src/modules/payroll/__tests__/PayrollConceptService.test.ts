// src/modules/payroll/__tests__/PayrollConceptService.test.ts
// Tests: NOM-B PayrollConceptService — CRUD + seedDefaults + system guard
// NOM-C-15: create/update/delete ahora usan $transaction + AuditLog

import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    payrollConcept: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { PayrollConceptService } from "../services/PayrollConceptService";

const COMPANY_ID = "company-test";
const USER_ID = "user-1";

const BASE_CONCEPT = {
  id: "concept-1",
  companyId: COMPANY_ID,
  code: "SAL_BASE",
  name: "Salario Básico",
  type: "EARNING" as const,
  isSystem: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Helper: simula $transaction pasando las mismas instancias mockeadas
function mockTx() {
  vi.mocked(prisma.$transaction).mockImplementation(
    ((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PayrollConceptService.list", () => {
  it("returns all concepts for a company", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([BASE_CONCEPT] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("SAL_BASE");
    expect(vi.mocked(prisma.payrollConcept.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID } })
    );
  });

  it("returns empty array when no concepts", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toHaveLength(0);
  });
});

describe("PayrollConceptService.seedDefaults", () => {
  it("upserts all 9 system concepts", async () => {
    vi.mocked(prisma.payrollConcept.upsert).mockResolvedValue(BASE_CONCEPT as never);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    expect(vi.mocked(prisma.payrollConcept.upsert)).toHaveBeenCalledTimes(9);
  });

  it("is idempotent — upsert with empty update", async () => {
    vi.mocked(prisma.payrollConcept.upsert).mockResolvedValue(BASE_CONCEPT as never);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    const firstCall = vi.mocked(prisma.payrollConcept.upsert).mock.calls[0][0];
    expect(firstCall.update).toEqual({});
  });
});

describe("PayrollConceptService.create", () => {
  it("creates a non-system concept and writes AuditLog", async () => {
    mockTx();
    const custom = { ...BASE_CONCEPT, id: "custom-1", code: "BONO_ESP", isSystem: false };
    vi.mocked(prisma.payrollConcept.create).mockResolvedValue(custom as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollConceptService.create(COMPANY_ID, USER_ID, {
      code: "BONO_ESP",
      name: "Bono Especial",
      type: "EARNING",
    });

    expect(result.code).toBe("BONO_ESP");
    expect(result.isSystem).toBe(false);
    expect(vi.mocked(prisma.payrollConcept.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isSystem: false }),
      })
    );
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREATE_PAYROLL_CONCEPT" }),
      })
    );
  });
});

describe("PayrollConceptService.update", () => {
  it("updates name and isActive with AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    vi.mocked(prisma.payrollConcept.update).mockResolvedValue({
      ...BASE_CONCEPT,
      name: "Salario Base Actualizado",
      isActive: false,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollConceptService.update(COMPANY_ID, USER_ID, "concept-1", {
      name: "Salario Base Actualizado",
      isActive: false,
    });

    expect(result.isActive).toBe(false);
    expect(result.name).toBe("Salario Base Actualizado");
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "UPDATE_PAYROLL_CONCEPT" }),
      })
    );
  });

  it("throws when concept not found", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.update(COMPANY_ID, USER_ID, "nonexistent", { name: "X", isActive: true })
    ).rejects.toThrow("Concepto no encontrado");
  });
});

describe("PayrollConceptService.delete", () => {
  it("deletes non-system concept and writes AuditLog", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue({
      ...BASE_CONCEPT,
      isSystem: false,
    } as never);
    vi.mocked(prisma.payrollConcept.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollConceptService.delete(COMPANY_ID, USER_ID, "concept-1");
    expect(vi.mocked(prisma.payrollConcept.delete)).toHaveBeenCalledWith({
      where: { id: "concept-1" },
    });
    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELETE_PAYROLL_CONCEPT" }),
      })
    );
  });

  it("throws when trying to delete system concept", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, USER_ID, "concept-1")
    ).rejects.toThrow("Los conceptos del sistema no se pueden eliminar");
  });

  it("throws when concept not found", async () => {
    mockTx();
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, USER_ID, "nonexistent")
    ).rejects.toThrow("Concepto no encontrado");
  });
});

describe("PayrollConceptService.getSystemConcepts", () => {
  it("returns only active system concepts", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([BASE_CONCEPT] as never);
    const result = await PayrollConceptService.getSystemConcepts(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(vi.mocked(prisma.payrollConcept.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: COMPANY_ID, isSystem: true, isActive: true },
      })
    );
  });
});
