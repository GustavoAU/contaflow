// src/modules/billing/services/PlanChangeService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  requestPlanChange,
  createPlanChangeCheckout,
  applyDuePlanChanges,
  cancelPlanChange,
  calculateEffectiveDate,
} from "./PlanChangeService";
import * as BillingService from "./BillingService";
import * as nowpayments from "@/lib/nowpayments";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    subscription: { findUnique: vi.fn(), update: vi.fn() },
    planChangeRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    subscriptionPayment: { create: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("./BillingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./BillingService")>();
  return { ...actual, getPlanPriceCents: vi.fn() };
});

vi.mock("@/lib/nowpayments", () => ({
  createNowPaymentsInvoice: vi.fn(),
}));

// tx helper: reproduce el prisma mockeado como cliente de transacción
function mockTransaction() {
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: unknown) => unknown) =>
    fn({
      planChangeRequest: prisma.planChangeRequest,
      subscription: prisma.subscription,
      subscriptionPayment: prisma.subscriptionPayment,
      auditLog: prisma.auditLog,
    })) as never);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const SUB_ID = "sub-1";
const USER_ID = "user-owner";

const ACTIVE_SUB = {
  id: SUB_ID,
  companyId: COMPANY_ID,
  plan: "MONTHLY",
  status: "ACTIVE",
  priceUsdCents: 7900,
  currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(BillingService.getPlanPriceCents).mockReturnValue(78000);
});

// ─── requestPlanChange ────────────────────────────────────────────────────────

describe("requestPlanChange", () => {
  it("crea la solicitud + AuditLog usando el precio de getPlanPriceCents (por perfil)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(ACTIVE_SUB as never);
    vi.mocked(prisma.planChangeRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ scopeProfile: "EMPRESA" } as never);
    vi.mocked(prisma.planChangeRequest.create).mockResolvedValue({ id: "req-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockTransaction();

    const res = await requestPlanChange(COMPANY_ID, "ANNUAL", USER_ID, "1.2.3.4", "UA");

    expect(BillingService.getPlanPriceCents).toHaveBeenCalledWith("EMPRESA", "ANNUAL");
    expect(res.newPriceUsdCents).toBe(78000);
    expect(res.planChangeRequestId).toBe("req-1");
    // effectiveDate = primer día del próximo mes UTC
    expect(res.effectiveDate.getUTCDate()).toBe(1);

    const createArg = vi.mocked(prisma.planChangeRequest.create).mock.calls[0][0];
    expect(createArg.data.newPriceUsdCents).toBe(78000);
    expect(createArg.data.fromPlan).toBe("MONTHLY");
    expect(createArg.data.toPlan).toBe("ANNUAL");
    expect(createArg.data.status).toBe("PENDING_PAYMENT");

    const auditArg = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(auditArg.data.action).toBe("PLAN_CHANGE_REQUESTED");
    expect(auditArg.data.ipAddress).toBe("1.2.3.4");
    expect(auditArg.data.userAgent).toBe("UA");
  });

  it("propaga el error de getPlanPriceCents (ej. SOLO + EARLY_ADOPTER)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(ACTIVE_SUB as never);
    vi.mocked(prisma.planChangeRequest.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ scopeProfile: "SOLO" } as never);
    vi.mocked(BillingService.getPlanPriceCents).mockImplementation(() => {
      throw new Error("El plan EARLY_ADOPTER no está disponible para el perfil SOLO.");
    });

    await expect(
      requestPlanChange(COMPANY_ID, "EARLY_ADOPTER", USER_ID, null, null),
    ).rejects.toThrow(/no está disponible para el perfil SOLO/);
    expect(prisma.planChangeRequest.create).not.toHaveBeenCalled();
  });

  it("rechaza si no hay suscripción", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    await expect(
      requestPlanChange(COMPANY_ID, "ANNUAL", USER_ID, null, null),
    ).rejects.toThrow(/no tiene una suscripción/i);
  });

  it("rechaza si la suscripción no está ACTIVE", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ ...ACTIVE_SUB, status: "PAST_DUE" } as never);
    await expect(
      requestPlanChange(COMPANY_ID, "ANNUAL", USER_ID, null, null),
    ).rejects.toThrow(/no está activa/i);
  });

  it("rechaza si ya está en ese plan", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(ACTIVE_SUB as never);
    await expect(
      requestPlanChange(COMPANY_ID, "MONTHLY", USER_ID, null, null),
    ).rejects.toThrow(/Ya estás en ese plan/i);
  });

  it("rechaza si ya hay una solicitud activa (pre-check)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(ACTIVE_SUB as never);
    vi.mocked(prisma.planChangeRequest.findFirst).mockResolvedValue({ id: "existing" } as never);
    await expect(
      requestPlanChange(COMPANY_ID, "ANNUAL", USER_ID, null, null),
    ).rejects.toThrow(/cambio de plan pendiente/i);
  });

  it("MEDIUM-1: P2002 en el create (índice único parcial) → mensaje de negocio", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(ACTIVE_SUB as never);
    vi.mocked(prisma.planChangeRequest.findFirst).mockResolvedValue(null); // pre-check pasa
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ scopeProfile: "EMPRESA" } as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.0.0",
    });
    vi.mocked(prisma.planChangeRequest.create).mockRejectedValue(p2002);
    mockTransaction();

    await expect(
      requestPlanChange(COMPANY_ID, "ANNUAL", USER_ID, null, null),
    ).rejects.toThrow(/cambio de plan pendiente/i);
  });
});

// ─── createPlanChangeCheckout ─────────────────────────────────────────────────

describe("createPlanChangeCheckout", () => {
  const PENDING_REQ = {
    id: "req-1",
    subscriptionId: SUB_ID,
    status: "PENDING_PAYMENT",
    toPlan: "ANNUAL",
    newPriceUsdCents: 78000,
    subscription: { id: SUB_ID, companyId: COMPANY_ID },
  };

  const INVOICE = { id: "inv-1", invoice_url: "https://pay" };

  it("crea SubscriptionPayment PENDING ligado a la request + AuditLog y devuelve invoiceUrl", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue(PENDING_REQ as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue({ id: "pay-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(nowpayments.createNowPaymentsInvoice).mockResolvedValue(INVOICE as never);
    mockTransaction();

    const res = await createPlanChangeCheckout("req-1", USER_ID, "1.2.3.4", "UA");

    expect(res.invoiceUrl).toBe("https://pay");
    expect(res.subscriptionPaymentId).toBe("pay-1");

    const createArg = vi.mocked(prisma.subscriptionPayment.create).mock.calls[0][0];
    expect(createArg.data.planChangeRequestId).toBe("req-1");
    expect(createArg.data.status).toBe("PENDING");
    expect(createArg.data.amountUsdCents).toBe(78000);

    const auditArg = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(auditArg.data.action).toBe("PLAN_CHANGE_CHECKOUT_INITIATED");
    expect(auditArg.data.ipAddress).toBe("1.2.3.4");

    // persiste el nowpaymentsOrderId del invoice
    const updArg = vi.mocked(prisma.subscriptionPayment.update).mock.calls[0][0];
    expect(updArg.data.nowpaymentsOrderId).toBe("inv-1");
  });

  it("rechaza si la request no existe", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue(null);
    await expect(createPlanChangeCheckout("nope", USER_ID, null, null)).rejects.toThrow(/no encontrada/i);
    expect(prisma.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it("rechaza si la request no está PENDING_PAYMENT", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue({
      ...PENDING_REQ,
      status: "CONFIRMED",
    } as never);
    await expect(createPlanChangeCheckout("req-1", USER_ID, null, null)).rejects.toThrow(
      /no está pendiente de pago/i,
    );
    expect(prisma.subscriptionPayment.create).not.toHaveBeenCalled();
  });
});

// ─── applyDuePlanChanges ──────────────────────────────────────────────────────

describe("applyDuePlanChanges", () => {
  const DUE_REQ = {
    id: "req-due",
    subscriptionId: SUB_ID,
    toPlan: "ANNUAL",
    newPriceUsdCents: 78000,
    effectiveDate: new Date("2026-07-01T00:00:00Z"),
  };

  it("aplica un CONFIRMED vencido: update subscription + APPLIED + AuditLog", async () => {
    vi.mocked(prisma.planChangeRequest.findMany).mockResolvedValue([DUE_REQ] as never);
    vi.mocked(prisma.planChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ companyId: COMPANY_ID } as never);
    vi.mocked(prisma.planChangeRequest.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockTransaction();

    const res = await applyDuePlanChanges();

    expect(res.applied).toBe(1);
    expect(res.errors).toEqual([]);
    expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    const subArg = vi.mocked(prisma.subscription.update).mock.calls[0][0];
    expect(subArg.data.plan).toBe("ANNUAL");
    expect(subArg.data.priceUsdCents).toBe(78000);
    const auditArg = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(auditArg.data.action).toBe("PLAN_CHANGE_APPLIED");
  });

  it("compare-and-swap: si otro proceso lo tomó (count=0) no aplica", async () => {
    vi.mocked(prisma.planChangeRequest.findMany).mockResolvedValue([DUE_REQ] as never);
    vi.mocked(prisma.planChangeRequest.updateMany).mockResolvedValue({ count: 0 } as never);
    mockTransaction();

    const res = await applyDuePlanChanges();

    expect(res.applied).toBe(1); // la iteración cuenta, pero no muta
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});

// ─── cancelPlanChange ─────────────────────────────────────────────────────────

describe("cancelPlanChange", () => {
  it("cancela una PENDING_PAYMENT: CAS + AuditLog con IP/UA", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      status: "PENDING_PAYMENT",
      subscription: { companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.planChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockTransaction();

    await cancelPlanChange("req-1", USER_ID, "razón", "9.9.9.9", "UA");

    const arg = vi.mocked(prisma.planChangeRequest.updateMany).mock.calls[0][0];
    expect(arg.data.status).toBe("CANCELED");
    expect(arg.data.cancelReason).toBe("razón");
    // CAS: solo cancela desde PENDING_PAYMENT/CONFIRMED (excluye APPLYING/APPLIED)
    expect(arg.where?.status).toEqual({ in: ["PENDING_PAYMENT", "CONFIRMED"] });
    const audit = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(audit.data.action).toBe("PLAN_CHANGE_CANCELED");
    expect(audit.data.ipAddress).toBe("9.9.9.9");
    expect(audit.data.userAgent).toBe("UA");
  });

  it("MEDIUM-2: rechaza si el cron ya la tomó (CAS count=0), sin AuditLog", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      status: "CONFIRMED",
      subscription: { companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.planChangeRequest.updateMany).mockResolvedValue({ count: 0 } as never);
    mockTransaction();

    await expect(cancelPlanChange("req-1", USER_ID, "x", null, null)).rejects.toThrow(
      /procesada o cancelada/i,
    );
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rechaza si no existe", async () => {
    vi.mocked(prisma.planChangeRequest.findUnique).mockResolvedValue(null);
    mockTransaction();
    await expect(cancelPlanChange("nope", USER_ID, "x", null, null)).rejects.toThrow(/no encontrada/i);
  });
});

// ─── calculateEffectiveDate ───────────────────────────────────────────────────

describe("calculateEffectiveDate", () => {
  it("devuelve el primer día del próximo mes UTC a medianoche", () => {
    const d = calculateEffectiveDate(new Date("2026-07-15T18:30:00Z"));
    expect(d.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rueda de diciembre a enero del año siguiente", () => {
    const d = calculateEffectiveDate(new Date("2026-12-20T00:00:00Z"));
    expect(d.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
