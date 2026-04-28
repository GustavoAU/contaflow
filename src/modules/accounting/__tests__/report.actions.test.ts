// src/modules/accounting/__tests__/report.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    transaction: { findMany: vi.fn() },
    account: { findMany: vi.fn() },
    accountingPeriod: { findFirst: vi.fn() },
  },
}));

import prisma from "@/lib/prisma";
import {
  getJournalAction,
  getLedgerAction,
  getTrialBalanceAction,
  getIncomeStatementAction,
  getBalanceSheetAction,
} from "../actions/report.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER = { role: "ACCOUNTANT" };

// ─── Helpers: tablas de casos (una por función auditada) ──────────────────────
const REPORT_ACTIONS = [
  { name: "getJournalAction", fn: () => getJournalAction(COMPANY_ID) },
  { name: "getLedgerAction", fn: () => getLedgerAction(COMPANY_ID) },
  { name: "getTrialBalanceAction", fn: () => getTrialBalanceAction(COMPANY_ID) },
  { name: "getIncomeStatementAction", fn: () => getIncomeStatementAction(COMPANY_ID) },
  { name: "getBalanceSheetAction", fn: () => getBalanceSheetAction(COMPANY_ID) },
];

// ─── Security regression — guard compartido ───────────────────────────────────
describe("report.actions — security guards (CRITICAL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
    vi.mocked(prisma.account.findMany).mockResolvedValue([]);
  });

  for (const { name, fn } of REPORT_ACTIONS) {
    it(`${name}: retorna error si no hay sesión autenticada`, async () => {
      mockAuth.mockResolvedValue({ userId: null });

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("No autorizado");
      expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    });

    it(`${name}: retorna error si rate limit agotado`, async () => {
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
      });

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
      expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    });

    it(`${name}: retorna error si usuario no es miembro (IDOR)`, async () => {
      vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Acceso denegado");
    });

    it(`${name}: retorna error si el rol es VIEWER`, async () => {
      vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "VIEWER" } as never);

      const result = await fn();

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain("Acceso denegado");
    });
  }
});
