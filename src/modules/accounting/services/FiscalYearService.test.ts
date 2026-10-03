// src/modules/accounting/services/FiscalYearService.test.ts
// ADR-055: ejercicio fiscal anual — Z-1/Z-3 (Serializable obligatorio, apertura
// secuencial sin huecos, máx. 2 OPEN simultáneos). Sin tests hasta ahora.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    fiscalYear: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    accountingPeriod: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi
    .fn()
    .mockImplementation((_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) =>
      fn(_tx)
    ),
}));

import prisma from "@/lib/prisma";
import { FiscalYearService } from "./FiscalYearService";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

/** Error de serialización de Postgres tal y como lo mapea Prisma (SSI abort). */
function p2034() {
  return Object.assign(new Error("could not serialize access due to read/write dependencies"), {
    code: "P2034",
  });
}

/** Encadena las llamadas dentro de la tx en el orden que hace openFiscalYear. */
function setupTxMock() {
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn({
      fiscalYear: prisma.fiscalYear,
      company: prisma.company,
      accountingPeriod: prisma.accountingPeriod,
      auditLog: prisma.auditLog,
    })) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupTxMock();
});

// ─── getActiveFiscalYear / getFiscalYears ──────────────────────────────────────

describe("FiscalYearService.getActiveFiscalYear", () => {
  it("retorna el FiscalYear OPEN más reciente", async () => {
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      id: "fy-1",
      year: 2026,
      status: "OPEN",
      periods: [],
    } as never);

    const result = await FiscalYearService.getActiveFiscalYear(COMPANY_ID);
    expect(result?.year).toBe(2026);
    expect(prisma.fiscalYear.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: COMPANY_ID, status: "OPEN" } })
    );
  });

  it("retorna null si no hay ningún ejercicio OPEN", async () => {
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    const result = await FiscalYearService.getActiveFiscalYear(COMPANY_ID);
    expect(result).toBeNull();
  });
});

// ─── openFiscalYear — bootstrap ────────────────────────────────────────────────

describe("FiscalYearService.openFiscalYear — bootstrap (primer ejercicio)", () => {
  it("lanza error si no se indica año", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(0);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ fiscalYearStartMonth: 1 } as never);

    await expect(FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID, undefined)).rejects.toThrow(
      "Debe indicar el año del primer ejercicio a abrir."
    );
  });

  it("régimen regular (startMonth=1): crea el ejercicio con 12 períodos enero-diciembre", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(0);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ fiscalYearStartMonth: 1 } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.create).mockResolvedValue({
      id: "fy-1",
      companyId: COMPANY_ID,
      year: 2026,
      startMonth: 1,
      status: "OPEN",
      openedBy: USER_ID,
    } as never);
    vi.mocked(prisma.accountingPeriod.createMany).mockResolvedValue({ count: 12 } as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `p-${i + 1}`,
        year: 2026,
        month: i + 1,
        status: "OPEN",
      })) as never
    );
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID, 2026);

    expect(result.year).toBe(2026);
    expect(result.startMonth).toBe(1);
    expect(result.periods).toHaveLength(12);

    const periodsData = vi.mocked(prisma.accountingPeriod.createMany).mock.calls[0]![0]!.data as {
      year: number;
      month: number;
    }[];
    expect(periodsData).toHaveLength(12);
    expect(periodsData[0]).toMatchObject({ year: 2026, month: 1 });
    expect(periodsData[11]).toMatchObject({ year: 2026, month: 12 });
    expect(prisma.auditLog.create).toHaveBeenCalledOnce();
  });

  it("régimen irregular jul-jun (startMonth=7): los 12 meses cruzan el año calendario", async () => {
    // Caso real de la tester (ADR-055 §diseño) — declaración ISLR jul-jun.
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(0);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ fiscalYearStartMonth: 7 } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.create).mockResolvedValue({
      id: "fy-1",
      companyId: COMPANY_ID,
      year: 2026,
      startMonth: 7,
      status: "OPEN",
      openedBy: USER_ID,
    } as never);
    vi.mocked(prisma.accountingPeriod.createMany).mockResolvedValue({ count: 12 } as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID, 2026);

    const periodsData = vi.mocked(prisma.accountingPeriod.createMany).mock.calls[0]![0]!.data as {
      year: number;
      month: number;
    }[];
    expect(periodsData).toHaveLength(12);
    // Jul-Dic 2026, luego Ene-Jun 2027 — sin huecos ni año calendario forzado.
    expect(periodsData[0]).toMatchObject({ year: 2026, month: 7 });
    expect(periodsData[5]).toMatchObject({ year: 2026, month: 12 });
    expect(periodsData[6]).toMatchObject({ year: 2027, month: 1 });
    expect(periodsData[11]).toMatchObject({ year: 2027, month: 6 });
  });
});

// ─── openFiscalYear — secuencial (D-10) ────────────────────────────────────────

describe("FiscalYearService.openFiscalYear — apertura secuencial (D-10)", () => {
  it("régimen regular: el próximo ejercicio siempre es year+1, mismo startMonth", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(1);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      year: 2026,
      startMonth: 1,
    } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.create).mockResolvedValue({
      id: "fy-2",
      companyId: COMPANY_ID,
      year: 2027,
      startMonth: 1,
      status: "OPEN",
      openedBy: USER_ID,
    } as never);
    vi.mocked(prisma.accountingPeriod.createMany).mockResolvedValue({ count: 12 } as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    // Sin bootstrapYear: el próximo ejercicio se calcula SIEMPRE del último persistido.
    const result = await FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID);

    expect(result.year).toBe(2027);
    const created = vi.mocked(prisma.fiscalYear.create).mock.calls[0]![0]!.data as {
      year: number;
      startMonth: number;
    };
    expect(created.year).toBe(2027);
    expect(created.startMonth).toBe(1);
  });

  it("régimen irregular jul-jun: el próximo ejercicio también empieza en julio, año siguiente", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(1);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      year: 2026,
      startMonth: 7,
    } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.create).mockResolvedValue({
      id: "fy-2",
      companyId: COMPANY_ID,
      year: 2027,
      startMonth: 7,
      status: "OPEN",
      openedBy: USER_ID,
    } as never);
    vi.mocked(prisma.accountingPeriod.createMany).mockResolvedValue({ count: 12 } as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID);

    expect(result.year).toBe(2027);
    const created = vi.mocked(prisma.fiscalYear.create).mock.calls[0]![0]!.data as {
      year: number;
      startMonth: number;
    };
    expect(created.startMonth).toBe(7);
  });

  it("lanza error si ya existe un FiscalYear para el año calculado", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(1);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      year: 2026,
      startMonth: 1,
    } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({ id: "fy-existing" } as never);

    await expect(FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID)).rejects.toThrow(
      "Ya existe un ejercicio fiscal para el año 2027."
    );
  });
});

// ─── openFiscalYear — D-9: máx. 2 OPEN simultáneos ─────────────────────────────

describe("FiscalYearService.openFiscalYear — D-9 (máx. 2 OPEN)", () => {
  it("rechaza abrir un 3er ejercicio si ya hay 2 OPEN", async () => {
    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(2);

    await expect(FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID)).rejects.toThrow(
      "Ya hay 2 ejercicios fiscales abiertos (el máximo permitido)."
    );
    // No debe seguir de largo a calcular/crear nada más.
    expect(prisma.fiscalYear.create).not.toHaveBeenCalled();
  });
});

// ─── openFiscalYear — retry P2034 (D-11) ───────────────────────────────────────

describe("FiscalYearService.openFiscalYear — reintento P2034 (Serializable)", () => {
  it("reintenta tras un abort de SSI y termina bien en el segundo intento", async () => {
    let attempt = 0;
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: unknown) => unknown) => {
      attempt += 1;
      if (attempt === 1) throw p2034();
      return fn({
        fiscalYear: prisma.fiscalYear,
        company: prisma.company,
        accountingPeriod: prisma.accountingPeriod,
        auditLog: prisma.auditLog,
      });
    }) as never);

    vi.mocked(prisma.fiscalYear.count).mockResolvedValue(0);
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ fiscalYearStartMonth: 1 } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.fiscalYear.create).mockResolvedValue({
      id: "fy-1",
      companyId: COMPANY_ID,
      year: 2026,
      startMonth: 1,
      status: "OPEN",
      openedBy: USER_ID,
    } as never);
    vi.mocked(prisma.accountingPeriod.createMany).mockResolvedValue({ count: 12 } as never);
    vi.mocked(prisma.accountingPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID, 2026);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result.year).toBe(2026);
  });

  it("agotados los 3 intentos el P2034 sale hacia arriba", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(p2034());

    await expect(FiscalYearService.openFiscalYear(COMPANY_ID, USER_ID, 2026)).rejects.toMatchObject(
      { code: "P2034" }
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

// ─── getActivePeriodInfo (fuente única — period.actions.ts + retention.actions.ts) ──

describe("FiscalYearService.getActivePeriodInfo", () => {
  it("retorna null si no hay ejercicio activo", async () => {
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null as never);
    const result = await FiscalYearService.getActivePeriodInfo(COMPANY_ID);
    expect(result).toBeNull();
  });

  it("retorna el mes de HOY si cae en un período OPEN del ejercicio activo", async () => {
    const today = new Date();
    const ty = today.getUTCFullYear();
    const tm = today.getUTCMonth() + 1;

    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      id: "fy-1",
      year: ty,
      startMonth: 1,
      openedAt: new Date(`${ty}-01-01`),
      periods: [{ id: "p-today", year: ty, month: tm, status: "OPEN" }],
    } as never);

    const result = await FiscalYearService.getActivePeriodInfo(COMPANY_ID);
    expect(result).toMatchObject({ id: "p-today", year: ty, month: tm, fiscalYear: ty });
  });

  it("si HOY no cae en ningún período del ejercicio, retorna el más reciente", async () => {
    // Ejercicio de un año lejano (2020) — hoy nunca va a caer ahí.
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
      id: "fy-old",
      year: 2020,
      startMonth: 1,
      openedAt: new Date("2020-01-01"),
      periods: [
        { id: "p-1", year: 2020, month: 1, status: "OPEN" },
        { id: "p-6", year: 2020, month: 6, status: "OPEN" },
        { id: "p-12", year: 2020, month: 12, status: "OPEN" },
      ],
    } as never);

    const result = await FiscalYearService.getActivePeriodInfo(COMPANY_ID);
    expect(result?.id).toBe("p-12"); // el más reciente cronológicamente
    expect(result?.fiscalYear).toBe(2020);
  });
});
