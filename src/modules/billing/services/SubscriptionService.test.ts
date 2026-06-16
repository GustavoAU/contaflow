import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import {
  getSubscriptionState,
  isWriteAllowed,
  assertWriteAllowed,
  runBillingLifecycle,
} from "./SubscriptionService";

vi.mock("@/lib/prisma", () => ({
  default: {
    subscription: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppTemplate: vi.fn().mockResolvedValue({ ok: false, skipped: true }),
}));

const COMPANY_ID = "company-1";
const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendEmail).mockResolvedValue({ ok: true });
  vi.mocked(sendWhatsAppTemplate).mockResolvedValue({ ok: false, skipped: true });
});

describe("getSubscriptionState", () => {
  it("sin suscripción → activa (pre-billing, no se corta)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    const s = await getSubscriptionState(COMPANY_ID);
    expect(s).toMatchObject({ hasSubscription: false, isActive: true, isExpired: false });
  });

  it("ACTIVE con período futuro → activa", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 10 * DAY),
    } as never);
    const s = await getSubscriptionState(COMPANY_ID);
    expect(s.isActive).toBe(true);
    expect(s.isExpired).toBe(false);
    expect(s.daysUntilExpiry).toBeGreaterThan(0);
  });

  it("ACTIVE con período vencido → expirada (solo lectura)", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() - 2 * DAY),
    } as never);
    const s = await getSubscriptionState(COMPANY_ID);
    expect(s.isActive).toBe(false);
    expect(s.isExpired).toBe(true);
  });

  it("PAST_DUE con período futuro (checkout en curso) → no corta", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "PAST_DUE",
      currentPeriodEnd: new Date(Date.now() + 5 * DAY),
    } as never);
    const s = await getSubscriptionState(COMPANY_ID);
    expect(s.isActive).toBe(true);
  });

  it("EXPIRED → solo lectura aunque la fecha fuera futura", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "EXPIRED",
      currentPeriodEnd: new Date(Date.now() + 5 * DAY),
    } as never);
    const s = await getSubscriptionState(COMPANY_ID);
    expect(s.isExpired).toBe(true);
  });
});

describe("isWriteAllowed", () => {
  it("sin suscripción → permite escritura", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    expect(await isWriteAllowed(COMPANY_ID)).toBe(true);
  });

  it("suscripción vencida → bloquea escritura", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() - DAY),
    } as never);
    expect(await isWriteAllowed(COMPANY_ID)).toBe(false);
  });
});

describe("assertWriteAllowed", () => {
  it("no lanza si la suscripción está activa", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 5 * DAY),
    } as never);
    await expect(assertWriteAllowed(COMPANY_ID)).resolves.toBeUndefined();
  });

  it("lanza si la suscripción venció", async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() - DAY),
    } as never);
    await expect(assertWriteAllowed(COMPANY_ID)).rejects.toThrow(/solo lectura/i);
  });

  it("fail-open: permite si la verificación de billing falla", async () => {
    vi.mocked(prisma.subscription.findUnique).mockRejectedValue(new Error("DB caída") as never);
    await expect(assertWriteAllowed(COMPANY_ID)).resolves.toBeUndefined();
  });
});

describe("runBillingLifecycle", () => {
  it("marca EXPIRED las vencidas y envía recordatorios 7d/3d", async () => {
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 2 } as never);
    // 1ra llamada (ventana 7d) retorna 1 empresa; 2da (ventana 3d) retorna 0
    vi.mocked(prisma.subscription.findMany)
      .mockResolvedValueOnce([
        {
          companyId: COMPANY_ID,
          company: {
            name: "ACME C.A.",
            telefono: "0412-1234567",
            members: [{ user: { email: "owner@acme.com" } }],
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await runBillingLifecycle(new Date());

    expect(result.expiredMarked).toBe(2);
    expect(result.reminders7Sent).toBe(1);
    expect(result.reminders3Sent).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    // WhatsApp se intenta porque hay teléfono (stub no-op sin credenciales)
    expect(sendWhatsAppTemplate).toHaveBeenCalledTimes(1);
  });

  it("no falla si una empresa no tiene emails de owner", async () => {
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.subscription.findMany)
      .mockResolvedValueOnce([
        { companyId: COMPANY_ID, company: { name: "Sin Email C.A.", telefono: null, members: [] } },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await runBillingLifecycle(new Date());

    expect(result.reminders7Sent).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
