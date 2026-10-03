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

// ADR-055: openPeriod/closePeriod (mes individual) se ELIMINARON de PeriodService —
// reemplazados por FiscalYearService.openFiscalYear (abre los 12 meses del ejercicio
// de una vez) y FiscalYearCloseService.closeFiscalYear (cierra el ejercicio completo).
// Sus tests viven en FiscalYearService.test.ts y FiscalYearCloseService.test.ts.

// `fiscalYear` incluido en el mock — assertDateInOpenPeriod ahora también exige que
// el FiscalYear del período esté OPEN (no solo el AccountingPeriod), y select() lo trae.
const mockPeriod = {
  id: "period-1",
  companyId: "company-1",
  year: 2026,
  month: 3,
  status: "OPEN",
  fiscalYear: { status: "OPEN" },
};

describe("PeriodService.assertDateInOpenPeriod (HC-02 Caja Chica)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna el período cuando la fecha cae dentro del período abierto", async () => {
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(mockPeriod as never);

    const result = await PeriodService.assertDateInOpenPeriod(
      "company-1",
      new Date("2026-03-15") // marzo 2026 = período abierto
    );

    expect(result.id).toBe("period-1");
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
  });

  it("usa getters UTC: una fecha de inicio de mes no se desplaza al mes anterior", async () => {
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(mockPeriod as never);

    // new Date("2026-03-01") = medianoche UTC; en husos negativos getMonth() local daría feb.
    await expect(
      PeriodService.assertDateInOpenPeriod("company-1", new Date("2026-03-01"))
    ).resolves.toMatchObject({ month: 3 });
  });

  it("lanza si el período está CLOSED", async () => {
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({
      ...mockPeriod,
      status: "CLOSED",
    } as never);

    await expect(
      PeriodService.assertDateInOpenPeriod("company-1", new Date("2026-03-15"))
    ).rejects.toThrow(/está cerrado/i);
  });

  // ADR-055 (nuevo): el AccountingPeriod puede seguir OPEN pero su FiscalYear ya se
  // cerró — closeFiscalYear cierra los 12 períodos Y el ejercicio en la misma tx, así
  // que en la práctica no deberían desincronizarse, pero el guard existe por si acaso
  // (defensa en profundidad, no confiar solo en el status del período individual).
  it("lanza si el período está OPEN pero su FiscalYear ya está CLOSED", async () => {
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue({
      ...mockPeriod,
      fiscalYear: { status: "CLOSED" },
    } as never);

    await expect(
      PeriodService.assertDateInOpenPeriod("company-1", new Date("2026-03-15"))
    ).rejects.toThrow(/está cerrado/i);
  });

  it("lanza si no existe período para esa fecha", async () => {
    vi.mocked(prisma.accountingPeriod.findUnique).mockResolvedValue(null);

    await expect(
      PeriodService.assertDateInOpenPeriod("company-1", new Date("2026-03-15"))
    ).rejects.toThrow(/No existe un período contable abierto/i);
  });
});
