// src/modules/billing/actions/billing.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { createCheckoutAction } from "./billing.actions";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "actor-1" }),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    subscription: { findUnique: vi.fn() },
  },
}));
vi.mock("../services/BillingService", () => ({
  createCheckout: vi.fn(),
}));

import * as BillingService from "../services/BillingService";
import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/lib/ratelimit";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";

const OWNER_MEMBER = {
  id: "member-1",
  userId: "actor-1",
  companyId: COMPANY_ID,
  role: "OWNER" as const,
};

const CHECKOUT_RESULT = {
  invoiceUrl: "https://nowpayments.io/payment/?iid=test",
  subscriptionPaymentId: "payment-1",
};

// ─── createCheckoutAction ─────────────────────────────────────────────────────

describe("createCheckoutAction", () => {
  beforeEach(() => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(OWNER_MEMBER as never);
    vi.mocked(BillingService.createCheckout).mockResolvedValue(CHECKOUT_RESULT);
  });

  it("crea checkout correctamente para OWNER", async () => {
    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invoiceUrl).toBe(CHECKOUT_RESULT.invoiceUrl);
    }
    expect(BillingService.createCheckout).toHaveBeenCalledWith(
      COMPANY_ID,
      "MONTHLY",
      "actor-1",
      null,
      null,
    );
  });

  it("rechaza si no está autenticado", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);

    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("No autorizado");
  });

  it("rechaza si el usuario no es OWNER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      ...OWNER_MEMBER,
      role: "ACCOUNTANT",
    } as never);

    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
  });

  it("rechaza si la empresa no existe", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
  });

  it("rechaza con plan inválido", async () => {
    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "TRIAL" as "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("Datos inválidos");
  });

  it("propaga error del servicio", async () => {
    vi.mocked(BillingService.createCheckout).mockRejectedValueOnce(
      new Error("No quedan slots de Early Adopter disponibles.")
    );

    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "EARLY_ADOPTER",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain("Early Adopter");
  });

  it("rechaza si se supera el rate limit", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, error: "Demasiadas solicitudes. Intente más tarde." });

    const result = await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "MONTHLY",
      payCurrency: "usdterc20",
    });

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain("Demasiadas solicitudes");
  });

  it("crea checkout para plan ANNUAL con precio correcto", async () => {
    await createCheckoutAction({
      companyId: COMPANY_ID,
      plan: "ANNUAL",
      payCurrency: "usdterc20",
    });

    expect(BillingService.createCheckout).toHaveBeenCalledWith(
      COMPANY_ID,
      "ANNUAL",
      "actor-1",
      null,
      null,
    );
  });
});
