// src/modules/payments/__tests__/payment.actions.test.ts
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
vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx),
  ),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/PaymentService", () => ({
  PaymentService: { create: vi.fn(), list: vi.fn() },
}));

import prisma from "@/lib/prisma";
import { createPaymentAction } from "../actions/payment.actions";
import { PaymentService } from "../services/PaymentService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const MEMBER = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };

const VALID_INPUT = {
  companyId: COMPANY_ID,
  method: "TRANSFERENCIA" as const,
  amountVes: "1160.00",
  currency: "VES" as const,
  date: "2026-03-10",
};

const MOCK_PAYMENT = {
  id: "pay-1",
  companyId: COMPANY_ID,
  method: "TRANSFERENCIA",
  amountVes: { toString: () => "1160.00" },
  currency: "VES",
  date: new Date("2026-03-10"),
  createdAt: new Date(),
};

// ─── createPaymentAction — security regression tests ─────────────────────────
describe("createPaymentAction — security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({ auditLog: prisma.auditLog })) as never,
    );
    vi.mocked(PaymentService.create).mockResolvedValue(MOCK_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.companyMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el rol es VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(
      { ...MEMBER, role: "VIEWER" } as never,
    );

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("usa userId autenticado como createdBy (ignora cliente)", async () => {
    await createPaymentAction({ ...VALID_INPUT, createdBy: "attacker-user" });

    expect(PaymentService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdBy: USER_ID }),
    );
  });

  it("happy path: crea pago y retorna { success: true }", async () => {
    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe("pay-1");
  });

  it("retorna { success: false } si rate limit está agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      error: "Demasiadas solicitudes. Intenta de nuevo en 30 segundos.",
    });

    const result = await createPaymentAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });
});
