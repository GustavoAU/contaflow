// src/modules/payroll/__tests__/nom-d.actions.test.ts
// Fase NOM-D: Tests de server actions — auth, roles, rate limit, IDOR, Zod, P2002

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockUserId = vi.hoisted(() => vi.fn().mockReturnValue({ userId: "user-1" }));
const mockRateLimit = vi.hoisted(() => vi.fn().mockResolvedValue({ allowed: true }));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockUserId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockRateLimit,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/BenefitAccrualService", () => ({
  BenefitAccrualService: {
    createBcvRate: vi.fn(),
    listBcvRates: vi.fn(),
    accrueQuarter: vi.fn(),
    postBenefitInterest: vi.fn(),
    getBalance: vi.fn(),
  },
}));
vi.mock("../services/VacationService", () => ({
  VacationService: {
    create: vi.fn(),
    listByEmployee: vi.fn(),
  },
}));
vi.mock("../services/ProfitSharingService", () => ({
  ProfitSharingService: {
    calculate: vi.fn(),
    listByEmployee: vi.fn(),
  },
}));
vi.mock("../services/TerminationService", () => ({
  TerminationService: {
    create: vi.fn(),
    update: vi.fn(),
    finalize: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { BenefitAccrualService } from "../services/BenefitAccrualService";
import { VacationService } from "../services/VacationService";
import { TerminationService } from "../services/TerminationService";
import {
  createBcvRateAction,
  accrueQuarterAction,
  postBenefitInterestAction,
  createVacationAction,
  createTerminationAction,
  finalizeTerminationAction,
  listTerminationsAction,
  getBenefitBalanceAction,
} from "../actions/nom-d.actions";

const COMPANY = "company-1";
const EMP_ID = "emp-1";
const TERM_ID = "term-1";

const ADMIN_MEMBER = { role: "OWNER" };
const ACCOUNTANT_MEMBER = { role: "ACCOUNTANT" };
const VIEWER_MEMBER = { role: "VIEWER" };

describe("Auth guard — unauthenticated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createBcvRateAction returns error if not authenticated", async () => {
    mockUserId.mockReturnValueOnce({ userId: null });
    const result = await createBcvRateAction(COMPANY, {});
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("No autorizado");
  });

  it("accrueQuarterAction returns error if not authenticated", async () => {
    mockUserId.mockReturnValueOnce({ userId: null });
    const result = await accrueQuarterAction(COMPANY, {});
    expect(result.success).toBe(false);
  });
});

describe("Role guard — write actions require ADMIN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
  });

  it("accrueQuarterAction blocks ACCOUNTANT role", async () => {
    const result = await accrueQuarterAction(COMPANY, { year: 2026, quarter: 1 });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Administrador");
  });

  it("postBenefitInterestAction blocks ACCOUNTANT role", async () => {
    const result = await postBenefitInterestAction(COMPANY, { year: 2026, month: 3 });
    expect(result.success).toBe(false);
  });

  it("createVacationAction blocks ACCOUNTANT role", async () => {
    const result = await createVacationAction(COMPANY, EMP_ID, {});
    expect(result.success).toBe(false);
  });

  it("createTerminationAction blocks ACCOUNTANT role", async () => {
    const result = await createTerminationAction(COMPANY, EMP_ID, {});
    expect(result.success).toBe(false);
  });

  it("finalizeTerminationAction blocks ACCOUNTANT role", async () => {
    const result = await finalizeTerminationAction(COMPANY, TERM_ID);
    expect(result.success).toBe(false);
  });
});

describe("Role guard — read actions require ACCOUNTING", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);
  });

  it("getBenefitBalanceAction blocks VIEWER", async () => {
    const result = await getBenefitBalanceAction(COMPANY, EMP_ID);
    expect(result.success).toBe(false);
  });

  it("listTerminationsAction blocks VIEWER", async () => {
    const result = await listTerminationsAction(COMPANY);
    expect(result.success).toBe(false);
  });
});

describe("Rate limit guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    mockRateLimit.mockResolvedValueOnce({ allowed: false });
  });

  it("accrueQuarterAction blocks when rate limit exceeded", async () => {
    const result = await accrueQuarterAction(COMPANY, { year: 2026, quarter: 1 });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Límite");
  });

  it("createTerminationAction blocks when rate limit exceeded", async () => {
    const result = await createTerminationAction(COMPANY, EMP_ID, {});
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("Límite");
  });
});

describe("Zod validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  });

  it("createBcvRateAction rejects rate > 500%", async () => {
    const result = await createBcvRateAction(COMPANY, {
      year: 2026,
      month: 3,
      annualRate: 501,
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("500%");
  });

  it("createBcvRateAction rejects negative rate", async () => {
    const result = await createBcvRateAction(COMPANY, {
      year: 2026,
      month: 3,
      annualRate: -5,
    });
    expect(result.success).toBe(false);
  });

  it("accrueQuarterAction rejects quarter > 4", async () => {
    const result = await accrueQuarterAction(COMPANY, { year: 2026, quarter: 5 });
    expect(result.success).toBe(false);
  });

  it("createVacationAction rejects vacationDays > 90", async () => {
    const result = await createVacationAction(COMPANY, EMP_ID, {
      periodYear: 2026,
      vacationDays: 91,
      bonusDays: 7,
      startDate: "2026-04-01",
      endDate: "2026-04-15",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("90");
  });

  it("createTerminationAction rejects invalid idempotencyKey", async () => {
    const result = await createTerminationAction(COMPANY, EMP_ID, {
      reason: "RESIGNATION",
      terminationDate: "2026-04-16",
      idempotencyKey: "not-a-uuid",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toContain("UUID");
  });

  it("CRITICAL-3: postBenefitInterestAction schema strips unknown rate field", async () => {
    // Even if caller sends annualRate, schema strips it — service only receives { year, month }
    // This verifies the schema boundary: no rate accepted in transactional action
    const { BenefitAccrualService } = await import("../services/BenefitAccrualService");
    vi.mocked(BenefitAccrualService.postBenefitInterest).mockResolvedValue({
      employeesProcessed: 0,
      totalInterest: "0",
    });

    const input: unknown = { year: 2026, month: 3, annualRate: 999 };
    const result = await postBenefitInterestAction(COMPANY, input);

    // Zod schema passes (strips annualRate), service is called
    expect(vi.mocked(BenefitAccrualService.postBenefitInterest)).toHaveBeenCalledWith(
      COMPANY, "user-1", 2026, 3  // annualRate NOT passed to service
    );
    expect(result.success).toBe(true);
  });
});

describe("Service delegation — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
  });

  it("accrueQuarterAction delegates to BenefitAccrualService", async () => {
    vi.mocked(BenefitAccrualService.accrueQuarter).mockResolvedValue({
      employeesProcessed: 5,
      totalAccrued: "2652.7780",
    });

    const result = await accrueQuarterAction(COMPANY, { year: 2026, quarter: 1 });
    expect(result.success).toBe(true);
    expect((result as { success: true; data: { employeesProcessed: number } }).data.employeesProcessed).toBe(5);
  });

  it("createTerminationAction delegates to TerminationService", async () => {
    vi.mocked(TerminationService.create).mockResolvedValue({ id: TERM_ID } as never);

    const result = await createTerminationAction(COMPANY, EMP_ID, {
      reason: "RESIGNATION",
      terminationDate: "2026-04-16",
      idempotencyKey: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    });
    expect(result.success).toBe(true);
  });

  it("listTerminationsAction — ACCOUNTING allowed", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(TerminationService.list).mockResolvedValue([]);

    const result = await listTerminationsAction(COMPANY);
    expect(result.success).toBe(true);
  });
});
