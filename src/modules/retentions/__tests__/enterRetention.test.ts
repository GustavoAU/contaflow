// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RetentionService } from "../services/RetentionService";
import { INCES_RATE, FAT_RATE } from "../schemas/retention.schema";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => {
  const mockPrisma = {
    $transaction: vi.fn(),
    retencion: {
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    accountingPeriod: { findFirst: vi.fn() },
    account: { findFirst: vi.fn() },
    transaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { prisma: mockPrisma, default: mockPrisma };
});

import prisma from "@/lib/prisma";
import { enterRetention } from "../services/RetentionService";

const mockRetention = {
  id: "ret-1",
  companyId: "comp-1",
  providerName: "Proveedor S.A.",
  voucherNumber: "CR-00000001",
  status: "PENDING",
  totalRetention: { toString: () => "120.00" },
  incesAmount: null,
  fatAmount: null,
  deletedAt: null,
};

const mockPeriod = { id: "period-1", companyId: "comp-1", status: "OPEN" };
const mockLiabilityAccount = { id: "acc-liab-1", companyId: "comp-1", type: "LIABILITY" };
const mockBankAccount = { id: "acc-bank-1", companyId: "comp-1", type: "ASSET" };
const mockTransaction = { id: "tx-1" };

describe("enterRetention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          retencion: prisma.retencion,
          accountingPeriod: prisma.accountingPeriod,
          account: prisma.account,
          transaction: prisma.transaction,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("happy path: entera retención PENDING y crea asiento DIARIO", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.account.findFirst)
      .mockResolvedValueOnce(mockLiabilityAccount as never)
      .mockResolvedValueOnce(mockBankAccount as never);
    vi.mocked(prisma.retencion.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue(mockTransaction as never);
    vi.mocked(prisma.retencion.update).mockResolvedValue({ ...mockRetention, status: "ENTERADO" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await expect(
      enterRetention(
        {
          retentionId: "ret-1",
          companyId: "comp-1",
          liabilityAccountId: "acc-liab-1",
          bankAccountId: "acc-bank-1",
          enterDate: new Date("2026-05-12"),
        },
        "user-1"
      )
    ).resolves.toBeUndefined();

    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "DIARIO",
          number: expect.stringMatching(/^ENT-/),
        }),
      })
    );
    expect(prisma.retencion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ENTERADO",
          // enteradoTransactionId preserva el asiento de emisión en transactionId (R-1)
          enteradoTransactionId: mockTransaction.id,
        }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ENTER_RETENTION",
          entityName: "Retencion",
        }),
      })
    );
  });

  it("lanza error si retención no existe", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(null as never);

    await expect(
      enterRetention(
        {
          retentionId: "no-existe",
          companyId: "comp-1",
          liabilityAccountId: "acc-liab-1",
          bankAccountId: "acc-bank-1",
          enterDate: new Date(),
        },
        "user-1"
      )
    ).rejects.toThrow("Retención no encontrada");
  });

  it("lanza error si retención ya está ENTERADA", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue({
      ...mockRetention,
      status: "ENTERADO",
    } as never);

    await expect(
      enterRetention(
        {
          retentionId: "ret-1",
          companyId: "comp-1",
          liabilityAccountId: "acc-liab-1",
          bankAccountId: "acc-bank-1",
          enterDate: new Date(),
        },
        "user-1"
      )
    ).rejects.toThrow("ya fue enterada");
  });

  it("lanza error si retención está VOIDED", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue({
      ...mockRetention,
      status: "VOIDED",
    } as never);

    await expect(
      enterRetention(
        {
          retentionId: "ret-1",
          companyId: "comp-1",
          liabilityAccountId: "acc-liab-1",
          bankAccountId: "acc-bank-1",
          enterDate: new Date(),
        },
        "user-1"
      )
    ).rejects.toThrow("anulada");
  });

  it("lanza error si no hay período contable abierto", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null as never);

    await expect(
      enterRetention(
        {
          retentionId: "ret-1",
          companyId: "comp-1",
          liabilityAccountId: "acc-liab-1",
          bankAccountId: "acc-bank-1",
          enterDate: new Date(),
        },
        "user-1"
      )
    ).rejects.toThrow("período contable abierto");
  });

  it("lanza error si cuenta de pasivo no encontrada", async () => {
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.account.findFirst)
      .mockResolvedValueOnce(null as never)  // liability not found
      .mockResolvedValueOnce(mockBankAccount as never);

    await expect(
      enterRetention(
        {
          retentionId: "ret-1",
          companyId: "comp-1",
          liabilityAccountId: "no-existe",
          bankAccountId: "acc-bank-1",
          enterDate: new Date(),
        },
        "user-1"
      )
    ).rejects.toThrow("Cuenta de pasivo");
  });
});

// ─── Tests INCES / FAT ────────────────────────────────────────────────────────
describe("RetentionService INCES/FAT", () => {
  it(`calcula INCES al ${INCES_RATE.pct}% sobre base 1000`, () => {
    const result = RetentionService.calculateIncesRetention("1000.00");
    expect(result.incesAmount).toBe("20.00");
    expect(result.incesRetentionPct).toBe(2);
  });

  it(`calcula FAT al ${FAT_RATE.pct}% sobre base 1000`, () => {
    const result = RetentionService.calculateFatRetention("1000.00");
    expect(result.fatAmount).toBe("7.50");
    expect(result.fatRetentionPct).toBe(0.75);
  });

  it("calculate() incluye INCES y FAT cuando applyInces=true y applyFat=true", () => {
    const result = RetentionService.calculate(
      "1000.00",
      75,
      undefined,
      16,
      "IVA",
      true,   // applyInces
      true    // applyFat
    );
    expect(result.incesAmount).toBe("20.00");
    expect(result.fatAmount).toBe("7.50");
    // total = 120 (IVA) + 20 (INCES) + 7.50 (FAT) = 147.50
    expect(result.totalRetention).toBe("147.50");
  });

  it("calculate() excluye INCES y FAT cuando applyInces=false (default)", () => {
    const result = RetentionService.calculate("1000.00", 75);
    expect(result.incesAmount).toBeNull();
    expect(result.fatAmount).toBeNull();
  });
});

// ─── Tests nuevos códigos ISLR ────────────────────────────────────────────────
describe("ISLR códigos 3% y 8%", () => {
  it("ACTIVIDAD_BURSATIL_PJ calcula al 3%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "ACTIVIDAD_BURSATIL_PJ");
    expect(result).not.toBeNull();
    expect(result!.islrRetentionPct).toBe(3);
    expect(result!.islrAmount).toBe("30.00");
  });

  it("CONSTRUCCION_PN calcula al 3%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "CONSTRUCCION_PN");
    expect(result).not.toBeNull();
    expect(result!.islrRetentionPct).toBe(3);
  });

  it("SUMINISTRO_TECNOLOGIA_PJ calcula al 8%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "SUMINISTRO_TECNOLOGIA_PJ");
    expect(result).not.toBeNull();
    expect(result!.islrRetentionPct).toBe(8);
    expect(result!.islrAmount).toBe("80.00");
  });

  it("ACTIVIDADES_EXTRACTIVAS_PJ calcula al 8%", () => {
    const result = RetentionService.calculateIslrRetention("1000.00", "ACTIVIDADES_EXTRACTIVAS_PJ");
    expect(result).not.toBeNull();
    expect(result!.islrRetentionPct).toBe(8);
  });
});
