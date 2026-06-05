// src/modules/payroll/__tests__/vacation-request.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/VacationRequestService", () => ({
  VacationRequestService: {
    listByEmployee: vi.fn(),
    listPending: vi.fn(),
    getBalance: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
    setInitialVacationBalance: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { VacationRequestService } from "../services/VacationRequestService";
import {
  getVacationRequestsAction,
  getVacationBalanceAction,
  createVacationRequestAction,
  approveVacationRequestAction,
  rejectVacationRequestAction,
  cancelVacationRequestAction,
  setInitialVacationBalanceAction,
} from "../actions/vacation-request.actions";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";
const EMP_ID = "emp-1";
const REQ_ID = "req-1";

const SAMPLE_REQUEST = {
  id: REQ_ID,
  companyId: COMPANY_ID,
  employeeId: EMP_ID,
  employeeName: "Ana García",
  startDate: "2026-07-01",
  endDate: "2026-07-15",
  daysRequested: "15.00",
  status: "PENDING" as const,
  notes: null,
  rejectionReason: null,
  reviewedByUserId: null,
  reviewedAt: null,
  createdByUserId: USER_ID,
  createdAt: new Date().toISOString(),
};

function setupOk(role = "ADMIN") {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role } as never);
}

// ─── getVacationRequestsAction ────────────────────────────────────────────────
describe("getVacationRequestsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista solicitudes de un empleado", async () => {
    setupOk("VIEWER");
    vi.mocked(VacationRequestService.listByEmployee).mockResolvedValue([SAMPLE_REQUEST]);

    const res = await getVacationRequestsAction(COMPANY_ID, EMP_ID);

    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toHaveLength(1);
  });

  it("lista solicitudes pendientes (sin employeeId)", async () => {
    setupOk("ADMIN");
    vi.mocked(VacationRequestService.listPending).mockResolvedValue([SAMPLE_REQUEST]);

    const res = await getVacationRequestsAction(COMPANY_ID);

    expect(res.success).toBe(true);
    expect(VacationRequestService.listPending).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("bloquea si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await getVacationRequestsAction(COMPANY_ID);

    expect(res.success).toBe(false);
  });
});

// ─── getVacationBalanceAction ─────────────────────────────────────────────────
describe("getVacationBalanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna balance del empleado", async () => {
    setupOk("VIEWER");
    const balance = {
      employeeId: EMP_ID, yearsOfService: 3, daysAccrued: 48,
      initialBalance: 0, daysUsed: 15, daysPending: 0, daysAvailable: 33,
    };
    vi.mocked(VacationRequestService.getBalance).mockResolvedValue(balance);

    const res = await getVacationBalanceAction(COMPANY_ID, EMP_ID);

    expect(res.success).toBe(true);
    if (res.success) expect(res.data.daysAvailable).toBe(33);
  });
});

// ─── createVacationRequestAction ─────────────────────────────────────────────
describe("createVacationRequestAction", () => {
  beforeEach(() => vi.clearAllMocks());

  const VALID = {
    employeeId: EMP_ID,
    startDate: "2026-07-01",
    endDate: "2026-07-15",
    daysRequested: "15",
    notes: "Vacaciones anuales",
  };

  it("crea solicitud cuando ADMIN", async () => {
    setupOk("ADMIN");
    vi.mocked(VacationRequestService.create).mockResolvedValue(SAMPLE_REQUEST);

    const res = await createVacationRequestAction(COMPANY_ID, VALID);

    expect(res.success).toBe(true);
    expect(VacationRequestService.create).toHaveBeenCalledTimes(1);
  });

  it("rechaza si endDate < startDate", async () => {
    setupOk("ADMIN");

    const res = await createVacationRequestAction(COMPANY_ID, {
      ...VALID,
      startDate: "2026-07-15",
      endDate: "2026-07-01",
    });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("anterior");
  });

  it("rechaza si días = 0", async () => {
    setupOk("ADMIN");

    const res = await createVacationRequestAction(COMPANY_ID, { ...VALID, daysRequested: "0" });

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("positivo");
  });

  it("bloquea si VIEWER intenta crear", async () => {
    setupOk("VIEWER");

    const res = await createVacationRequestAction(COMPANY_ID, VALID);

    expect(res.success).toBe(false);
  });

  it("bloquea si rate limit agotado", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({ role: "ADMIN" } as never);

    const res = await createVacationRequestAction(COMPANY_ID, VALID);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Demasiadas");
  });
});

// ─── approveVacationRequestAction ────────────────────────────────────────────
describe("approveVacationRequestAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aprueba cuando ACCOUNTANT", async () => {
    setupOk("ACCOUNTANT");
    vi.mocked(VacationRequestService.approve).mockResolvedValue({ ...SAMPLE_REQUEST, status: "APPROVED" });

    const res = await approveVacationRequestAction(COMPANY_ID, REQ_ID);

    expect(res.success).toBe(true);
  });

  it("bloquea si VIEWER intenta aprobar", async () => {
    setupOk("VIEWER");

    const res = await approveVacationRequestAction(COMPANY_ID, REQ_ID);

    expect(res.success).toBe(false);
  });
});

// ─── rejectVacationRequestAction ─────────────────────────────────────────────
describe("rejectVacationRequestAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rechaza con motivo cuando ADMIN", async () => {
    setupOk("ADMIN");
    vi.mocked(VacationRequestService.reject).mockResolvedValue({ ...SAMPLE_REQUEST, status: "REJECTED" });

    const res = await rejectVacationRequestAction(COMPANY_ID, REQ_ID, { rejectionReason: "Período ocupado" });

    expect(res.success).toBe(true);
  });

  it("falla si no hay motivo", async () => {
    setupOk("ADMIN");

    const res = await rejectVacationRequestAction(COMPANY_ID, REQ_ID, { rejectionReason: "" });

    expect(res.success).toBe(false);
  });
});

// ─── cancelVacationRequestAction ─────────────────────────────────────────────
describe("cancelVacationRequestAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancela cuando ADMINISTRATIVE", async () => {
    setupOk("ADMINISTRATIVE");
    vi.mocked(VacationRequestService.cancel).mockResolvedValue({ ...SAMPLE_REQUEST, status: "CANCELLED" });

    const res = await cancelVacationRequestAction(COMPANY_ID, REQ_ID);

    expect(res.success).toBe(true);
  });

  it("bloquea si VIEWER intenta cancelar", async () => {
    setupOk("VIEWER");

    const res = await cancelVacationRequestAction(COMPANY_ID, REQ_ID);

    expect(res.success).toBe(false);
  });
});

// ─── setInitialVacationBalanceAction — Feature 4 ──────────────────────────────
describe("setInitialVacationBalanceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registra saldo inicial cuando ACCOUNTANT", async () => {
    setupOk("ACCOUNTANT");
    vi.mocked(VacationRequestService.setInitialVacationBalance).mockResolvedValue(undefined);

    const res = await setInitialVacationBalanceAction(COMPANY_ID, {
      employeeId: EMP_ID,
      initialVacationDays: "25",
    });

    expect(res.success).toBe(true);
  });

  it("falla con días negativos", async () => {
    setupOk("ACCOUNTANT");

    const res = await setInitialVacationBalanceAction(COMPANY_ID, {
      employeeId: EMP_ID,
      initialVacationDays: "-5",
    });

    expect(res.success).toBe(false);
  });

  it("bloquea si VIEWER", async () => {
    setupOk("VIEWER");

    const res = await setInitialVacationBalanceAction(COMPANY_ID, {
      employeeId: EMP_ID,
      initialVacationDays: "10",
    });

    expect(res.success).toBe(false);
  });
});
