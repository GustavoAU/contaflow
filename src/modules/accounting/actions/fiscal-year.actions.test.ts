// src/modules/accounting/actions/fiscal-year.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: mockHeaders }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));

vi.mock("../services/FiscalYearService", () => ({
  FiscalYearService: {
    getActiveFiscalYear: vi.fn(),
    getFiscalYears: vi.fn(),
    openFiscalYear: vi.fn(),
  },
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { FiscalYearService } from "../services/FiscalYearService";
import {
  getActiveFiscalYearAction,
  getFiscalYearsAction,
  openFiscalYearAction,
} from "./fiscal-year.actions";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const OWNER_MEMBER = { role: "OWNER" };

function headersWith(map: Record<string, string> = {}) {
  mockHeaders.mockResolvedValue({ get: (name: string) => map[name.toLowerCase()] ?? null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ userId: USER_ID } as never);
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
  headersWith({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest-agent/1.0" });
});

// ─── getActiveFiscalYearAction ──────────────────────────────────────────────────

describe("getActiveFiscalYearAction", () => {
  it("retorna error si no autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await getActiveFiscalYearAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });

  it("MEMBER_ANY: un VIEWER puede consultar (solo lectura)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);
    vi.mocked(FiscalYearService.getActiveFiscalYear).mockResolvedValue(null);
    const r = await getActiveFiscalYearAction(COMPANY_ID);
    expect(r.success).toBe(true);
  });

  it("happy path — delega en FiscalYearService.getActiveFiscalYear", async () => {
    vi.mocked(FiscalYearService.getActiveFiscalYear).mockResolvedValue({
      id: "fy-1", year: 2026,
    } as never);
    const r = await getActiveFiscalYearAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data?.year).toBe(2026);
  });

  it("retorna error estructurado si el service lanza", async () => {
    vi.mocked(FiscalYearService.getActiveFiscalYear).mockRejectedValue(new Error("DB error"));
    const r = await getActiveFiscalYearAction(COMPANY_ID);
    expect(r.success).toBe(false);
  });
});

// ─── getFiscalYearsAction ────────────────────────────────────────────────────────

describe("getFiscalYearsAction", () => {
  it("happy path — delega en FiscalYearService.getFiscalYears", async () => {
    vi.mocked(FiscalYearService.getFiscalYears).mockResolvedValue([
      { id: "fy-2", year: 2027 } as never,
      { id: "fy-1", year: 2026 } as never,
    ]);
    const r = await getFiscalYearsAction(COMPANY_ID);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toHaveLength(2);
  });
});

// ─── openFiscalYearAction ─────────────────────────────────────────────────────────

describe("openFiscalYearAction", () => {
  const BASE_INPUT = { companyId: COMPANY_ID, year: 2026 };

  it("retorna error si no autenticado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);
    const r = await openFiscalYearAction(BASE_INPUT);
    expect(r.success).toBe(false);
  });

  it("ADMIN_ONLY: ACCOUNTANT no puede abrir un ejercicio", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    const r = await openFiscalYearAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("autorizado");
  });

  it("OWNER puede abrir un ejercicio", async () => {
    vi.mocked(FiscalYearService.openFiscalYear).mockResolvedValue({
      id: "fy-1", companyId: COMPANY_ID, year: 2026, startMonth: 1, status: "OPEN",
      openedBy: USER_ID, openedAt: new Date(), closedAt: null, closedBy: null,
      periods: Array.from({ length: 12 }, (_, i) => ({ id: `p-${i}`, year: 2026, month: i + 1, status: "OPEN" as const })),
    });

    const r = await openFiscalYearAction(BASE_INPUT);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.year).toBe(2026);
      expect(r.data.periodCount).toBe(12);
    }
  });

  it("valida year fuera de rango (Zod)", async () => {
    const r = await openFiscalYearAction({ companyId: COMPANY_ID, year: 1500 });
    expect(r.success).toBe(false);
    expect(FiscalYearService.openFiscalYear).not.toHaveBeenCalled();
  });

  it("year es opcional (apertura secuencial, no-bootstrap)", async () => {
    vi.mocked(FiscalYearService.openFiscalYear).mockResolvedValue({
      id: "fy-2", companyId: COMPANY_ID, year: 2027, startMonth: 1, status: "OPEN",
      openedBy: USER_ID, openedAt: new Date(), closedAt: null, closedBy: null,
      periods: [],
    });

    const r = await openFiscalYearAction({ companyId: COMPANY_ID });
    expect(r.success).toBe(true);
  });

  it("propaga el mensaje de negocio si el service lanza (ej. D-9, máx 2 OPEN)", async () => {
    vi.mocked(FiscalYearService.openFiscalYear).mockRejectedValue(
      new Error("Ya hay 2 ejercicios fiscales abiertos (el máximo permitido).")
    );
    const r = await openFiscalYearAction(BASE_INPUT);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("máximo permitido");
  });

  it("captura ipAddress/userAgent (R-6) y los pasa al service", async () => {
    vi.mocked(FiscalYearService.openFiscalYear).mockResolvedValue({
      id: "fy-1", companyId: COMPANY_ID, year: 2026, startMonth: 1, status: "OPEN",
      openedBy: USER_ID, openedAt: new Date(), closedAt: null, closedBy: null, periods: [],
    });

    await openFiscalYearAction(BASE_INPUT);

    expect(FiscalYearService.openFiscalYear).toHaveBeenCalledWith(
      COMPANY_ID, USER_ID, 2026, "203.0.113.9", "vitest-agent/1.0"
    );
  });
});
