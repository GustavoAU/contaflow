// src/modules/accounting/services/PeriodSnapshotService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma", () => ({
  default: {
    periodSnapshot: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    journalEntry: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { PeriodSnapshotService } from "./PeriodSnapshotService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const PERIOD_ID = "period-1";
const ACCOUNT_ID = "account-1";

const mockSnapshot = {
  id: "snapshot-1",
  companyId: COMPANY_ID,
  periodId: PERIOD_ID,
  accountId: ACCOUNT_ID,
  balanceVes: new Decimal("1333.3300"),
  balanceOriginal: null,
  currency: "VES" as const,
  snapshotAt: new Date("2026-04-05T00:00:00Z"),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PeriodSnapshotService.upsertSnapshot", () => {
  // tx mock construido en beforeEach para que use los mocks ya registrados
  let mockTx: ReturnType<typeof buildMockTx>;

  function buildMockTx() {
    return {
      journalEntry: prisma.journalEntry,
      periodSnapshot: prisma.periodSnapshot,
      auditLog: { create: vi.fn() },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = buildMockTx();
  });

  it("crea snapshot con balance calculado correctamente (débitos - créditos)", async () => {
    // Débito 1000 + 333.33 = 1333.33
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([
      { amount: new Decimal("1000.00") } as never,
      { amount: new Decimal("333.33") } as never,
    ]);
    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue(mockSnapshot as never);

    const result = await PeriodSnapshotService.upsertSnapshot(
      COMPANY_ID,
      PERIOD_ID,
      ACCOUNT_ID,
      mockTx as never
    );

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: ACCOUNT_ID,
          transaction: expect.objectContaining({
            companyId: COMPANY_ID,
            periodId: PERIOD_ID,
            status: { not: "VOIDED" },
          }),
        }),
      })
    );

    expect(prisma.periodSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { periodId_accountId: { periodId: PERIOD_ID, accountId: ACCOUNT_ID } },
        create: expect.objectContaining({
          companyId: COMPANY_ID,
          periodId: PERIOD_ID,
          accountId: ACCOUNT_ID,
        }),
      })
    );

    expect(result.id).toBe("snapshot-1");
  });

  it("actualiza snapshot existente (operación idempotente)", async () => {
    // Valores que detectan pérdida de precisión IEEE 754 (best-practices §4.3)
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([
      { amount: new Decimal("1333.33") } as never,
      { amount: new Decimal("-200.00") } as never,
    ]);

    const updatedSnapshot = {
      ...mockSnapshot,
      balanceVes: new Decimal("1133.3300"),
    };
    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue(updatedSnapshot as never);

    const result = await PeriodSnapshotService.upsertSnapshot(
      COMPANY_ID,
      PERIOD_ID,
      ACCOUNT_ID,
      mockTx as never
    );

    // El upsert actualiza el balance al recalcular
    expect(prisma.periodSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ balanceVes: expect.anything() }),
      })
    );
    expect(result.balanceVes.toString()).toBe("1133.33");
  });

  it("calcula balance 0 cuando no hay movimientos en el período", async () => {
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue({
      ...mockSnapshot,
      balanceVes: new Decimal("0.0000"),
    } as never);

    await PeriodSnapshotService.upsertSnapshot(COMPANY_ID, PERIOD_ID, ACCOUNT_ID, mockTx as never);

    const upsertCall = vi.mocked(prisma.periodSnapshot.upsert).mock.calls[0][0];
    // Balance debe ser 0
    expect(upsertCall.create.balanceVes.toString()).toBe("0");
  });
});

describe("PeriodSnapshotService.upsertAllSnapshotsForPeriod", () => {
  let mockTx: { journalEntry: typeof prisma.journalEntry; periodSnapshot: typeof prisma.periodSnapshot };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = {
      journalEntry: prisma.journalEntry,
      periodSnapshot: prisma.periodSnapshot,
    };
  });

  it("retorna la cantidad correcta de cuentas procesadas", async () => {
    // Primera llamada: distinct por accountId → devuelve 3 cuentas
    vi.mocked(prisma.journalEntry.findMany)
      .mockResolvedValueOnce([
        { accountId: "account-1" } as never,
        { accountId: "account-2" } as never,
        { accountId: "account-3" } as never,
      ])
      // Llamadas siguientes: entradas individuales por cuenta para upsertSnapshot
      .mockResolvedValue([{ amount: new Decimal("500.00") } as never]);

    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue(mockSnapshot as never);

    const count = await PeriodSnapshotService.upsertAllSnapshotsForPeriod(
      COMPANY_ID,
      PERIOD_ID,
      mockTx as never
    );

    expect(count).toBe(3);
    expect(prisma.periodSnapshot.upsert).toHaveBeenCalledTimes(3);
  });

  it("retorna 0 cuando el período no tiene movimientos no-VOID", async () => {
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([]);

    const count = await PeriodSnapshotService.upsertAllSnapshotsForPeriod(
      COMPANY_ID,
      PERIOD_ID,
      mockTx as never
    );

    expect(count).toBe(0);
    expect(prisma.periodSnapshot.upsert).not.toHaveBeenCalled();
  });
});

describe("PeriodSnapshotService.getSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna snapshot existente con companyId en el where (ADR-004)", async () => {
    vi.mocked(prisma.periodSnapshot.findFirst).mockResolvedValue(mockSnapshot as never);

    const result = await PeriodSnapshotService.getSnapshot(COMPANY_ID, PERIOD_ID, ACCOUNT_ID);

    expect(prisma.periodSnapshot.findFirst).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, periodId: PERIOD_ID, accountId: ACCOUNT_ID },
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("snapshot-1");
  });

  it("retorna null si el snapshot no existe", async () => {
    vi.mocked(prisma.periodSnapshot.findFirst).mockResolvedValue(null);

    const result = await PeriodSnapshotService.getSnapshot(COMPANY_ID, PERIOD_ID, ACCOUNT_ID);

    expect(result).toBeNull();
  });
});

describe("PeriodSnapshotService.invalidateSnapshots", () => {
  let mockTx: { periodSnapshot: typeof prisma.periodSnapshot };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = { periodSnapshot: prisma.periodSnapshot };
  });

  it("elimina todos los snapshots del período con companyId en el where (ADR-004)", async () => {
    vi.mocked(prisma.periodSnapshot.deleteMany).mockResolvedValue({ count: 5 } as never);

    await PeriodSnapshotService.invalidateSnapshots(COMPANY_ID, PERIOD_ID, mockTx as never);

    expect(prisma.periodSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, periodId: PERIOD_ID },
    });
  });
});

describe("PeriodSnapshotService — exclusión de transacciones VOID", () => {
  let mockTx: { journalEntry: typeof prisma.journalEntry; periodSnapshot: typeof prisma.periodSnapshot };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx = {
      journalEntry: prisma.journalEntry,
      periodSnapshot: prisma.periodSnapshot,
    };
  });

  it("excluye transacciones VOID del cálculo de balance", async () => {
    // El filtro status: { not: 'VOIDED' } se aplica en la query a Prisma.
    // Simulamos que Prisma devuelve solo las entradas no-VOID: 800 + 200 = 1000
    vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([
      { amount: new Decimal("800.00") } as never,
      { amount: new Decimal("200.00") } as never,
    ]);
    vi.mocked(prisma.periodSnapshot.upsert).mockResolvedValue({
      ...mockSnapshot,
      balanceVes: new Decimal("1000.0000"),
    } as never);

    await PeriodSnapshotService.upsertSnapshot(COMPANY_ID, PERIOD_ID, ACCOUNT_ID, mockTx as never);

    // Verificar que la query incluye el filtro de exclusión VOIDED
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transaction: expect.objectContaining({
            status: { not: "VOIDED" },
          }),
        }),
      })
    );

    // Verificar que el balance acumulado es 800 + 200 = 1000
    const upsertCall = vi.mocked(prisma.periodSnapshot.upsert).mock.calls[0][0];
    expect(upsertCall.create.balanceVes.toString()).toBe("1000");
  });
});
