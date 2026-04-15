// src/modules/payroll/__tests__/PayrollConceptService.test.ts
// Tests: NOM-B PayrollConceptService — CRUD + seedDefaults + system guard

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
  },
}));

import { PayrollConceptService } from "../services/PayrollConceptService";

const COMPANY_ID = "company-test";

const BASE_CONCEPT = {
  id: "concept-1",
  companyId: COMPANY_ID,
  code: "SAL_BASE",
  name: "Salario Básico",
  type: "EARNING" as const,
  isSystem: true,
  isActive: true,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

beforeEach(() => vi.clearAllMocks());

describe("PayrollConceptService.list", () => {
  it("returns empty array when no concepts", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toEqual([]);
  });

  it("serializes concept correctly", async () => {
    vi.mocked(prisma.payrollConcept.findMany).mockResolvedValue([BASE_CONCEPT] as never);
    const result = await PayrollConceptService.list(COMPANY_ID);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("SAL_BASE");
    expect(result[0].isSystem).toBe(true);
    expect(typeof result[0].updatedAt).toBe("string");
  });
});

describe("PayrollConceptService.seedDefaults", () => {
  it("calls upsert for each system concept (9 concepts)", async () => {
    vi.mocked(prisma.payrollConcept.upsert).mockResolvedValue(BASE_CONCEPT as never);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    expect(vi.mocked(prisma.payrollConcept.upsert)).toHaveBeenCalledTimes(9);
  });

  it("uses companyId_code as unique key for upsert", async () => {
    vi.mocked(prisma.payrollConcept.upsert).mockResolvedValue(BASE_CONCEPT as never);
    await PayrollConceptService.seedDefaults(COMPANY_ID);
    const firstCall = vi.mocked(prisma.payrollConcept.upsert).mock.calls[0][0];
    expect(firstCall.where).toHaveProperty("companyId_code");
    expect(firstCall.create).toHaveProperty("isSystem", true);
    // update is empty → idempotente
    expect(firstCall.update).toEqual({});
  });
});

describe("PayrollConceptService.create", () => {
  it("creates a non-system concept", async () => {
    const custom = { ...BASE_CONCEPT, id: "custom-1", code: "BONO_ESP", isSystem: false };
    vi.mocked(prisma.payrollConcept.create).mockResolvedValue(custom as never);

    const result = await PayrollConceptService.create(COMPANY_ID, {
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
  });
});

describe("PayrollConceptService.update", () => {
  it("updates name and isActive", async () => {
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    vi.mocked(prisma.payrollConcept.update).mockResolvedValue({
      ...BASE_CONCEPT,
      name: "Salario Base Actualizado",
      isActive: false,
    } as never);

    const result = await PayrollConceptService.update(COMPANY_ID, "concept-1", {
      name: "Salario Base Actualizado",
      isActive: false,
    });

    expect(result.isActive).toBe(false);
    expect(result.name).toBe("Salario Base Actualizado");
  });

  it("throws when concept not found", async () => {
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.update(COMPANY_ID, "nonexistent", { name: "X", isActive: true })
    ).rejects.toThrow("Concepto no encontrado");
  });
});

describe("PayrollConceptService.delete", () => {
  it("deletes non-system concept", async () => {
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue({
      ...BASE_CONCEPT,
      isSystem: false,
    } as never);
    vi.mocked(prisma.payrollConcept.delete).mockResolvedValue({} as never);

    await PayrollConceptService.delete(COMPANY_ID, "concept-1");
    expect(vi.mocked(prisma.payrollConcept.delete)).toHaveBeenCalledWith({
      where: { id: "concept-1" },
    });
  });

  it("throws when trying to delete system concept", async () => {
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(BASE_CONCEPT as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, "concept-1")
    ).rejects.toThrow("Los conceptos del sistema no se pueden eliminar");
  });

  it("throws when concept not found", async () => {
    vi.mocked(prisma.payrollConcept.findFirst).mockResolvedValue(null as never);
    await expect(
      PayrollConceptService.delete(COMPANY_ID, "nonexistent")
    ).rejects.toThrow("Concepto no encontrado");
  });
});
