// src/modules/payroll/__tests__/PayrollConfigService.test.ts
// Tests: NOM-A-02 ($transaction + AuditLog), happy path

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    payrollConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { PayrollConfigService } from "../services/PayrollConfigService";

const COMPANY_ID = "company-test";
const USER_ID = "user-test";

const BASE_INPUT = {
  sizeRange: "SMALL" as const,
  lottRegime: "POST_2012" as const,
  ivssEnabled: true,
  incesEnabled: true,
  banavihEnabled: true,
  cestaTicketType: "CARD" as const,
  paymentCurrency: "VES" as const,
  frequency: "BIWEEKLY" as const,
  fideicomiso: "INTERNAL" as const,
};

function makeConfigDb(overrides = {}) {
  return {
    id: "cfg-1",
    companyId: COMPANY_ID,
    ...BASE_INPUT,
    createdAt: new Date("2026-04-15"),
    updatedAt: new Date("2026-04-15"),
    ...overrides,
  };
}

describe("PayrollConfigService.getConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna null si no existe configuración", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null);
    const result = await PayrollConfigService.getConfig(COMPANY_ID);
    expect(result).toBeNull();
  });

  it("retorna la configuración serializada", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(makeConfigDb() as never);
    const result = await PayrollConfigService.getConfig(COMPANY_ID);
    expect(result).not.toBeNull();
    expect(result!.sizeRange).toBe("SMALL");
    expect(result!.ivssEnabled).toBe(true);
    expect(result!.frequency).toBe("BIWEEKLY");
    expect(typeof result!.updatedAt).toBe("string"); // serializado a ISO string
  });
});

describe("PayrollConfigService.isConfigured", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna false si count es 0", async () => {
    vi.mocked(prisma.payrollConfig.count).mockResolvedValue(0);
    expect(await PayrollConfigService.isConfigured(COMPANY_ID)).toBe(false);
  });

  it("retorna true si count es 1", async () => {
    vi.mocked(prisma.payrollConfig.count).mockResolvedValue(1);
    expect(await PayrollConfigService.isConfigured(COMPANY_ID)).toBe(true);
  });
});

describe("PayrollConfigService.saveConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock $transaction: ejecuta el callback con un tx que contiene payrollConfig y auditLog
    vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn({
        payrollConfig: prisma.payrollConfig,
        auditLog: prisma.auditLog,
      })) as never
    );
  });

  it("NOM-A-02: CREATE — AuditLog registra action CREATE_PAYROLL_CONFIG con oldValue null", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null); // No existe previa
    vi.mocked(prisma.payrollConfig.upsert).mockResolvedValue(makeConfigDb() as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollConfigService.saveConfig(COMPANY_ID, USER_ID, BASE_INPUT);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityName: "PayrollConfig",
          action: "CREATE_PAYROLL_CONFIG",
          userId: USER_ID,
          // Prisma.JsonNull se usa para null en campos Json? — no es el literal null
          oldValue: Prisma.JsonNull,
          newValue: expect.objectContaining({ sizeRange: "SMALL" }),
        }),
      })
    );
  });

  it("NOM-A-02: UPDATE — AuditLog registra action UPDATE_PAYROLL_CONFIG con oldValue previo", async () => {
    const previous = makeConfigDb({ sizeRange: "MEDIUM", ivssEnabled: false });
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(previous as never);
    vi.mocked(prisma.payrollConfig.upsert).mockResolvedValue(makeConfigDb() as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await PayrollConfigService.saveConfig(COMPANY_ID, USER_ID, BASE_INPUT);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_PAYROLL_CONFIG",
          oldValue: expect.objectContaining({ sizeRange: "MEDIUM", ivssEnabled: false }),
          newValue: expect.objectContaining({ sizeRange: "SMALL", ivssEnabled: true }),
        }),
      })
    );
  });

  it("NOM-A-02: AuditLog está dentro del mismo $transaction (no fire-and-forget)", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.payrollConfig.upsert).mockResolvedValue(makeConfigDb() as never);
    // Si auditLog falla, el $transaction debería revertir el upsert
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("AuditLog DB error"));

    await expect(
      PayrollConfigService.saveConfig(COMPANY_ID, USER_ID, BASE_INPUT)
    ).rejects.toThrow("AuditLog DB error");
  });

  it("devuelve la configuración serializada tras guardar", async () => {
    vi.mocked(prisma.payrollConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.payrollConfig.upsert).mockResolvedValue(makeConfigDb() as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PayrollConfigService.saveConfig(COMPANY_ID, USER_ID, BASE_INPUT);

    expect(result.id).toBe("cfg-1");
    expect(result.companyId).toBe(COMPANY_ID);
    expect(result.sizeRange).toBe("SMALL");
  });
});
