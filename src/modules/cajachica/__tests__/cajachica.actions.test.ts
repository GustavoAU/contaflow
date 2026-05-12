import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockListCajasCajas = vi.hoisted(() => vi.fn());
const mockCreateCajaCaja = vi.hoisted(() => vi.fn());
const mockCreateMovement = vi.hoisted(() => vi.fn());
const mockApproveMovement = vi.hoisted(() => vi.fn());
const mockListMovements = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
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
vi.mock("../services/CajaCajaService", () => ({
  createCajaCaja: mockCreateCajaCaja,
  listCajasCajas: mockListCajasCajas,
  getCajaCajaById: vi.fn(),
  closeCajaCaja: vi.fn(),
}));
vi.mock("../services/CajaCajaMovementService", () => ({
  createMovement: mockCreateMovement,
  approveMovement: mockApproveMovement,
  voidMovement: vi.fn(),
  listMovements: mockListMovements,
}));
vi.mock("../services/CajaCajaDepositService", () => ({
  createDeposit: vi.fn(),
  voidDeposit: vi.fn(),
  listDeposits: vi.fn(),
}));
vi.mock("../services/CajaCajaReimbursementService", () => ({
  createReimbursement: vi.fn(),
  postReimbursement: vi.fn(),
  voidReimbursement: vi.fn(),
  listReimbursements: vi.fn(),
}));

import prisma from "@/lib/prisma";
import {
  listCajasCajasAction,
  createCajaCajaAction,
  createMovementAction,
  approveMovementAction,
} from "../actions/cajachica.actions";

const COMPANY_ID = "comp-1";
const USER_ID = "user-1";

function setupAdmin() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ADMIN",
  } as never);
}

function setupWriter() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
    role: "ADMINISTRATIVE",
  } as never);
}

const mockCaja = {
  id: "caja-1",
  name: "Caja Operativa",
  accountId: "acc-1",
  accountCode: "1010",
  accountName: "Caja VES",
  currency: "VES",
  maxBalance: "1000000.00",
  status: "ACTIVE",
  createdAt: new Date().toISOString(),
  closedAt: null,
  totalDeposited: "0.00",
  totalPendingMovements: "0.00",
  totalApprovedMovements: "0.00",
  availableBalance: "0.00",
  percentUsed: 0,
};

beforeEach(() => vi.clearAllMocks());

// ─── Auth guards ──────────────────────────────────────────────────────────────

describe("auth guards", () => {
  it("listCajasCajasAction → 401 sin sesión", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/autenticado/i);
  });

  it("listCajasCajasAction → 403 rate limit", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/límite/i);
  });

  it("listCajasCajasAction → 403 sin membresía", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/miembro/i);
  });

  it("createCajaCajaAction → 403 para ACCOUNTANT (requiere ADMIN)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      role: "ACCOUNTANT",
    } as never);
    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
  });
});

// ─── createCajaCajaAction ─────────────────────────────────────────────────────

describe("createCajaCajaAction", () => {
  it("crea caja correctamente", async () => {
    setupAdmin();
    mockCreateCajaCaja.mockResolvedValue(mockCaja);

    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja Operativa",
      accountId: "acc-1",
      maxBalance: "1000000",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("Caja Operativa");
  });

  it("propaga error del servicio", async () => {
    setupAdmin();
    mockCreateCajaCaja.mockRejectedValue(new Error("Cuenta no encontrada"));

    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      name: "Caja",
      accountId: "acc-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe("Cuenta no encontrada");
  });

  it("falla con Zod si falta nombre", async () => {
    setupAdmin();
    const result = await createCajaCajaAction({
      companyId: COMPANY_ID,
      accountId: "acc-1",
      maxBalance: "100000",
    });
    expect(result.success).toBe(false);
  });
});

// ─── listCajasCajasAction ─────────────────────────────────────────────────────

describe("listCajasCajasAction", () => {
  it("devuelve lista correctamente para ADMINISTRATIVE", async () => {
    setupWriter();
    mockListCajasCajas.mockResolvedValue([mockCaja]);

    const result = await listCajasCajasAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(1);
  });
});

// ─── createMovementAction ─────────────────────────────────────────────────────

describe("createMovementAction", () => {
  const validMovement = {
    companyId: COMPANY_ID,
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    concept: "Café",
    expenseAccountId: "acc-exp",
    amount: "150000",
    currency: "VES",
  };

  const mockMovement = {
    id: "mov-1",
    cajaCajaId: "caja-1",
    date: "2026-05-12",
    voucherNumber: "CCC-2026-00001",
    concept: "Café",
    description: null,
    expenseAccountId: "acc-exp",
    expenseAccountCode: "6010",
    expenseAccountName: "Gastos Operativos",
    amount: "150000.00",
    currency: "VES",
    status: "PENDING",
    approvedAt: null,
    approvedBy: null,
    reimbursementId: null,
    createdAt: new Date().toISOString(),
    voidedAt: null,
  };

  it("crea movimiento para ADMINISTRATIVE", async () => {
    setupWriter();
    mockCreateMovement.mockResolvedValue(mockMovement);

    const result = await createMovementAction(validMovement);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.voucherNumber).toBe("CCC-2026-00001");
  });

  it("rechaza movimiento > 500K sin soporte", async () => {
    setupWriter();
    const result = await createMovementAction({
      ...validMovement,
      amount: "600000",
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/soporte/i);
  });
});

// ─── approveMovementAction ────────────────────────────────────────────────────

describe("approveMovementAction", () => {
  it("aprueba movimiento (requiere ADMIN)", async () => {
    setupAdmin();
    mockApproveMovement.mockResolvedValue({ id: "mov-1", status: "APPROVED" });

    const result = await approveMovementAction({
      movementId: "mov-1",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza aprobación para ADMINISTRATIVE", async () => {
    setupWriter();
    const result = await approveMovementAction({
      movementId: "mov-1",
      companyId: COMPANY_ID,
    });
    expect(result.success).toBe(false);
    expect((result as { success: false; error: string }).error).toMatch(/admin/i);
  });
});
