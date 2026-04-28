// src/modules/payroll/__tests__/LegalThresholdService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    legalThreshold: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { LegalThresholdService } from "../services/LegalThresholdService";

const COMPANY_ID = "company-test";

const SAMPLE_ROW = {
  id: "th-1",
  companyId: COMPANY_ID,
  type: "SALARY_MIN_VES" as const,
  effectiveFrom: new Date("2026-01-01"),
  value: { toString: () => "130.00" },
  notes: "Decreto 5.163",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("LegalThresholdService.getActive", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna Decimal cuando existe threshold vigente", async () => {
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(SAMPLE_ROW as never);

    const result = await LegalThresholdService.getActive(
      COMPANY_ID,
      "SALARY_MIN_VES",
      new Date("2026-03-01"),
    );

    expect(result).toBeInstanceOf(Decimal);
    expect(result?.toFixed(2)).toBe("130.00");
  });

  it("retorna null cuando no hay threshold configurado", async () => {
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null);

    const result = await LegalThresholdService.getActive(
      COMPANY_ID,
      "SALARY_MIN_VES",
      new Date("2026-03-01"),
    );

    expect(result).toBeNull();
  });

  it("pasa lte: date y orderBy: desc para obtener el vigente", async () => {
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(SAMPLE_ROW as never);

    await LegalThresholdService.getActive(COMPANY_ID, "SALARY_MIN_VES", new Date("2026-06-15"));

    expect(prisma.legalThreshold.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY_ID,
          type: "SALARY_MIN_VES",
          effectiveFrom: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        orderBy: { effectiveFrom: "desc" },
      }),
    );
  });
});

describe("LegalThresholdService.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("devuelve lista serializada ordenada por tipo y fecha desc", async () => {
    vi.mocked(prisma.legalThreshold.findMany).mockResolvedValue([SAMPLE_ROW] as never);

    const result = await LegalThresholdService.list(COMPANY_ID);

    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveFrom).toBe("2026-01-01");
    expect(result[0]!.value).toBe("130.00");
    expect(result[0]!.type).toBe("SALARY_MIN_VES");
  });

  it("devuelve lista vacía si no hay thresholds", async () => {
    vi.mocked(prisma.legalThreshold.findMany).mockResolvedValue([] as never);

    const result = await LegalThresholdService.list(COMPANY_ID);

    expect(result).toHaveLength(0);
  });
});

describe("LegalThresholdService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crea registro y devuelve fila serializada", async () => {
    vi.mocked(prisma.legalThreshold.create).mockResolvedValue(SAMPLE_ROW as never);

    const result = await LegalThresholdService.create(COMPANY_ID, {
      type: "SALARY_MIN_VES",
      effectiveFrom: new Date("2026-01-01"),
      value: new Decimal("130.00"),
      notes: "Decreto 5.163",
    });

    expect(result.value).toBe("130.00");
    expect(result.notes).toBe("Decreto 5.163");
    expect(prisma.legalThreshold.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          type: "SALARY_MIN_VES",
          value: expect.any(Decimal),
        }),
      }),
    );
  });
});

describe("LegalThresholdService.delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("elimina cuando el registro pertenece a la empresa", async () => {
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(SAMPLE_ROW as never);
    vi.mocked(prisma.legalThreshold.delete).mockResolvedValue(SAMPLE_ROW as never);

    await expect(LegalThresholdService.delete(COMPANY_ID, "th-1")).resolves.toBeUndefined();
    expect(prisma.legalThreshold.delete).toHaveBeenCalledWith({ where: { id: "th-1" } });
  });

  it("lanza error si el registro no pertenece a la empresa (IDOR guard)", async () => {
    vi.mocked(prisma.legalThreshold.findFirst).mockResolvedValue(null);

    await expect(
      LegalThresholdService.delete(COMPANY_ID, "th-other"),
    ).rejects.toThrow("Registro no encontrado");
  });
});
