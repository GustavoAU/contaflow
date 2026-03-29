// src/modules/accounting/services/PeriodService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    accountingPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import { PeriodService } from "./PeriodService";

const mockPeriod = {
  id: "period-1",
  companyId: "company-1",
  year: 2026,
  month: 3,
  status: "OPEN",
  openedAt: new Date("2026-03-01"),
  closedAt: null,
  openedBy: "user-1",
  closedBy: null,
};

describe("PeriodService.openPeriod", () => {
  beforeEach(() => vi.clearAllMocks());

  it("abre un per├¡odo correctamente cuando no hay per├¡odo activo", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.create).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PeriodService.openPeriod("company-1", 2026, 3, "user-1");

    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.status).toBe("OPEN");
  });

  it("lanza error si ya hay un per├¡odo abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);

    await expect(PeriodService.openPeriod("company-1", 2026, 4, "user-1")).rejects.toThrow(
      "Ya existe un período abierto"
    );
  });

  it("lanza error si el per├¡odo ya existe", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(mockPeriod as never);

    await expect(PeriodService.openPeriod("company-1", 2026, 3, "user-1")).rejects.toThrow(
      "ya existe"
    );
  });
});

describe("PeriodService.closePeriod", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cierra el per├¡odo activo correctamente", async () => {
    const closedPeriod = {
      ...mockPeriod,
      status: "CLOSED",
      closedAt: new Date(),
      closedBy: "user-1",
    };
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.accountingPeriod.update).mockResolvedValue(closedPeriod as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PeriodService.closePeriod("company-1", "user-1");

    expect(result.status).toBe("CLOSED");
    expect(result.closedBy).toBe("user-1");
  });

  it("lanza error si no hay per├¡odo abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(PeriodService.closePeriod("company-1", "user-1")).rejects.toThrow(
      "No hay período abierto"
    );
  });
});