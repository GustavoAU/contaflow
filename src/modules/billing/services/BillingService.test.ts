// src/modules/billing/services/BillingService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { createCheckout, handleIPN } from "./BillingService";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    subscription: {
      findUnique: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    subscriptionPayment: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    planChangeRequest: { updateMany: vi.fn() },
    company: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/nowpayments", () => ({
  createNowPaymentsInvoice: vi.fn(),
}));

import * as nowpayments from "@/lib/nowpayments";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const ACTOR_ID = "actor-1";
const SUB_ID = "sub-1";
const PAYMENT_ID = "payment-1";

const SUBSCRIPTION_PAST_DUE = {
  id: SUB_ID,
  companyId: COMPANY_ID,
  plan: "MONTHLY",
  status: "PAST_DUE",
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(),
  priceUsdCents: 7900,
  earlyAdopterSlot: null,
};

const SUBSCRIPTION_PAYMENT = {
  id: PAYMENT_ID,
  subscriptionId: SUB_ID,
  status: "PENDING",
  amountUsdCents: 7900,
  currency: "usd",
  metadata: { plan: "MONTHLY", companyId: COMPANY_ID },
  nowpaymentsPaymentId: null,
  subscription: SUBSCRIPTION_PAST_DUE,
};

const INVOICE = {
  id: "np-invoice-1",
  token_id: "token-1",
  order_id: PAYMENT_ID,
  price_amount: 79,
  price_currency: "usd",
  pay_currency: "usdterc20",
  ipn_callback_url: "https://contaflow.app/api/webhooks/nowpayments",
  invoice_url: "https://nowpayments.io/payment/?iid=np-invoice-1",
};

// ─── createCheckout ───────────────────────────────────────────────────────────

describe("createCheckout", () => {
  beforeEach(() => {
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          subscription: prisma.subscription,
          subscriptionPayment: prisma.subscriptionPayment,
          auditLog: prisma.auditLog,
        })) as never
    );
    vi.mocked(nowpayments.createNowPaymentsInvoice).mockResolvedValue(INVOICE);
    // Por defecto, empresa sin perfil SOLO → pricing EMPRESA (precio completo)
    vi.mocked(prisma.company.findUnique).mockResolvedValue(null as never);
  });

  it("crea checkout para plan MONTHLY correctamente", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.subscription.upsert).mockResolvedValue(SUBSCRIPTION_PAST_DUE as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createCheckout(COMPANY_ID, "MONTHLY", ACTOR_ID, null, null);

    expect(result.invoiceUrl).toBe(INVOICE.invoice_url);
    expect(result.subscriptionPaymentId).toBe(PAYMENT_ID);
    expect(nowpayments.createNowPaymentsInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        priceAmountCents: 7900,
        orderId: PAYMENT_ID,
      })
    );
  });

  it("usa precio Individual ($69 mensual) cuando scopeProfile es SOLO", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ scopeProfile: "SOLO" } as never);
    vi.mocked(prisma.subscription.upsert).mockResolvedValue(SUBSCRIPTION_PAST_DUE as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await createCheckout(COMPANY_ID, "MONTHLY", ACTOR_ID, null, null);

    expect(nowpayments.createNowPaymentsInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ priceAmountCents: 6900 })
    );
  });

  it("rechaza EARLY_ADOPTER para perfil SOLO (plan no disponible)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ scopeProfile: "SOLO" } as never);

    await expect(
      createCheckout(COMPANY_ID, "EARLY_ADOPTER", ACTOR_ID, null, null)
    ).rejects.toThrow(/no está disponible/i);
  });

  it("lanza error si ya existe suscripción ACTIVE", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...SUBSCRIPTION_PAST_DUE,
      status: "ACTIVE",
    } as never);

    await expect(
      createCheckout(COMPANY_ID, "MONTHLY", ACTOR_ID, null, null)
    ).rejects.toThrow("ya tiene una suscripción activa");
  });

  it("lanza error si no quedan slots de EARLY_ADOPTER", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(10 as never);

    await expect(
      createCheckout(COMPANY_ID, "EARLY_ADOPTER", ACTOR_ID, null, null)
    ).rejects.toThrow("No quedan slots");
  });

  it("asigna el primer slot disponible en EARLY_ADOPTER", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.subscription.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([
      { earlyAdopterSlot: 1 },
      { earlyAdopterSlot: 2 },
    ] as never);
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({
      ...SUBSCRIPTION_PAST_DUE,
      plan: "EARLY_ADOPTER",
      earlyAdopterSlot: 3,
    } as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await createCheckout(COMPANY_ID, "EARLY_ADOPTER", ACTOR_ID, null, null);

    expect(prisma.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ earlyAdopterSlot: 3 }),
      })
    );
  });

  it("crea SubscriptionPayment con priceUsdCents correcto para ANNUAL", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.subscription.upsert).mockResolvedValue({
      ...SUBSCRIPTION_PAST_DUE,
      plan: "ANNUAL",
      priceUsdCents: 78000,
    } as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue({
      ...SUBSCRIPTION_PAYMENT,
      amountUsdCents: 78000,
    } as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue(SUBSCRIPTION_PAYMENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await createCheckout(COMPANY_ID, "ANNUAL", ACTOR_ID, "1.2.3.4", "Mozilla/5.0");

    expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountUsdCents: 78000 }),
      })
    );
  });
});

// ─── handleIPN ────────────────────────────────────────────────────────────────

describe("handleIPN", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          subscriptionPayment: prisma.subscriptionPayment,
          subscription: prisma.subscription,
          planChangeRequest: prisma.planChangeRequest,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  const BASE_IPN = {
    payment_id: "np-payment-123",
    payment_status: "finished" as const,
    pay_address: "0xabc",
    price_amount: 79,
    price_currency: "usd",
    pay_currency: "usdterc20",
    actually_paid: 79,
    order_id: PAYMENT_ID,
  };

  it("activa la suscripción cuando payment_status es finished", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(
      SUBSCRIPTION_PAYMENT as never
    );
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await handleIPN(BASE_IPN);

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUB_ID },
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
    expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMED", nowpaymentsPaymentId: "np-payment-123" }),
      })
    );
  });

  it("aplica despachoTier al confirmar pago de checkout de tier Despacho (ADR-034)", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue({
      ...SUBSCRIPTION_PAYMENT,
      metadata: { despachoTierUpgrade: "PRO", companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await handleIPN(BASE_IPN);

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE", despachoTier: "PRO" }),
      })
    );
  });

  it("NO aplica despachoTier si el pago no es un checkout de Despacho", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(
      SUBSCRIPTION_PAYMENT as never
    );
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await handleIPN(BASE_IPN);

    const call = vi.mocked(prisma.subscription.update).mock.calls[0][0];
    expect(call.data).not.toHaveProperty("despachoTier");
  });

  it("cambio de plan: confirma la PlanChangeRequest y NO activa la suscripción", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue({
      ...SUBSCRIPTION_PAYMENT,
      planChangeRequestId: "req-1",
      metadata: { planChange: true, toPlan: "ANNUAL", companyId: COMPANY_ID },
    } as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planChangeRequest.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await handleIPN(BASE_IPN, "5.5.5.5");

    // marca la solicitud CONFIRMED con guard de idempotencia PENDING_PAYMENT
    expect(prisma.planChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1", status: "PENDING_PAYMENT" },
        data: expect.objectContaining({ status: "CONFIRMED", confirmedByUserId: "system" }),
      })
    );
    // NO activa la suscripción — es un cambio de plan, no una renovación
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    const auditArg = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(auditArg.data.action).toBe("PLAN_CHANGE_CONFIRMED");
  });

  it("es idempotente — ignora IPN si ya está CONFIRMED", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue({
      ...SUBSCRIPTION_PAYMENT,
      status: "CONFIRMED",
    } as never);

    await handleIPN(BASE_IPN);

    expect(prisma.subscriptionPayment.update).not.toHaveBeenCalled();
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("actualiza estado a CONFIRMING sin activar suscripción", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(
      SUBSCRIPTION_PAYMENT as never
    );
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);

    await handleIPN({ ...BASE_IPN, payment_status: "confirming" });

    expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONFIRMING" }),
      })
    );
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("actualiza estado a FAILED cuando payment_status es failed", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(
      SUBSCRIPTION_PAYMENT as never
    );
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);

    await handleIPN({ ...BASE_IPN, payment_status: "failed" });

    expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("lanza error si el pago no existe", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(null as never);

    await expect(handleIPN(BASE_IPN)).rejects.toThrow("no encontrado");
  });

  it("busca el pago por nowpaymentsPaymentId como fallback", async () => {
    vi.mocked(prisma.subscriptionPayment.findFirst).mockResolvedValue(
      SUBSCRIPTION_PAYMENT as never
    );
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    await handleIPN({ ...BASE_IPN, order_id: "unknown", payment_id: "np-payment-123" });

    expect(prisma.subscriptionPayment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ nowpaymentsPaymentId: "np-payment-123" }),
          ]),
        }),
      })
    );
  });
});
