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
    fiscalYearClose: {
      findUnique: vi.fn(),
    },
    journalEntry: {
      findMany: vi.fn(),
    },
    periodSnapshot: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Fase 15: ejercicio no cerrado por defecto en todos los tests de openPeriod
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({ accountingPeriod: prisma.accountingPeriod, auditLog: prisma.auditLog })) as never
    );
  });

  it("abre un período correctamente cuando no hay período activo", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.create).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await PeriodService.openPeriod("company-1", 2026, 3, "user-1");

    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.status).toBe("OPEN");
  });

  it("lanza error si ya hay un período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);

    await expect(PeriodService.openPeriod("company-1", 2026, 4, "user-1")).rejects.toThrow(
      "Ya existe un período abierto"
    );
  });

  it("lanza error si el período ya existe", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(mockPeriod as never);

    await expect(PeriodService.openPeriod("company-1", 2026, 3, "user-1")).rejects.toThrow(
      "ya existe"
    );
  });
});

describe("PeriodService.closePeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fase 13C-B4: el $transaction ahora también ejecuta PeriodSnapshotService
    // El tx mock incluye journalEntry y periodSnapshot para que upsertAllSnapshotsForPeriod funcione
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          accountingPeriod: prisma.accountingPeriod,
          journalEntry: prisma.journalEntry,
          periodSnapshot: prisma.periodSnapshot,
          auditLog: prisma.auditLog,
        })) as never
    );
    // Por defecto: sin movimientos en el período (upsertAllSnapshotsForPeriod retorna 0)
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([]);
  });

  it("cierra el período activo correctamente", async () => {
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

  it("llama a upsertAllSnapshotsForPeriod dentro del $transaction al cerrar", async () => {
    const { Decimal } = await import("decimal.js");
    const closedPeriod = { ...mockPeriod, status: "CLOSED", closedAt: new Date(), closedBy: "user-1" };
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(mockPeriod as never);
    vi.mocked(prisma.accountingPeriod.update).mockResolvedValue(closedPeriod as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // Simular 1 cuenta con movimiento
    vi.mocked(prisma.journalEntry.findMany)
      .mockResolvedValueOnce([{ accountId: "account-1" } as never])
      .mockResolvedValue([{ amount: new Decimal("500.00") } as never]);
    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue({
      id: "snap-1", companyId: "company-1", periodId: "period-1", accountId: "account-1",
      balanceVes: new Decimal("500.00"), balanceOriginal: null, currency: "VES",
      snapshotAt: new Date(),
    } as never);

    await PeriodService.closePeriod("company-1", "user-1");

    expect(prisma.periodSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("lanza error si no hay período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    await expect(PeriodService.closePeriod("company-1", "user-1")).rejects.toThrow(
      "No hay período abierto"
    );
  });
});
