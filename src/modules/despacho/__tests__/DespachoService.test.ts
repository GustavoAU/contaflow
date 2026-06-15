// TDD SPEC — todos los tests DEBEN fallar hasta que DespachoService exista.
// No modificar este archivo — implementar en DespachoService.ts para que pasen.
// Entrega: agente de implementación (fase feat/tier-despacho).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  canAddManagedClient,
  addManagedClient,
  archiveManagedClient,
  listManagedClients,
  upgradeDespachoTier,
} from "../services/DespachoService";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    managedClient: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscriptionPayment: {
      create: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/nowpayments", () => ({
  createNowPaymentsInvoice: vi.fn(),
}));

import * as nowpayments from "@/lib/nowpayments";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "despacho-company-1";
const OTHER_COMPANY_ID = "other-company-99";
const ACTOR_ID = "user-actor-1";
const CLIENT_ID = "managed-client-1";
const SUB_ID = "sub-1";
const IP = "192.168.1.1";
const UA = "Mozilla/5.0";

const BASE_INPUT = {
  rif: "J-12345678-9",
  clientName: "Empresa ABC C.A.",
  ciiu: "6201",
  notes: "Cliente principal",
};

const MANAGED_CLIENT = {
  id: CLIENT_ID,
  despachoCompanyId: COMPANY_ID,
  rif: "J-12345678-9",
  clientName: "Empresa ABC C.A.",
  ciiu: "6201",
  notes: "Cliente principal",
  status: "ACTIVE" as const,
  linkedCompanyId: null,
  createdBy: ACTOR_ID,
  deletedAt: null,
  deletedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SUBSCRIPTION_STARTER = {
  id: SUB_ID,
  companyId: COMPANY_ID,
  plan: "MONTHLY",
  status: "ACTIVE",
  despachoTier: "STARTER",
  priceUsdCents: 5900,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(),
  earlyAdopterSlot: null,
};

const SUBSCRIPTION_PRO = { ...SUBSCRIPTION_STARTER, despachoTier: "PRO" };
const SUBSCRIPTION_UNLIMITED = { ...SUBSCRIPTION_STARTER, despachoTier: "UNLIMITED" };

const NP_INVOICE = {
  id: "np-inv-1",
  token_id: "token-1",
  order_id: "payment-1",
  price_amount: 99,
  price_currency: "usd",
  pay_currency: "usdterc20",
  ipn_callback_url: "https://contaflow.app/api/webhooks/nowpayments",
  invoice_url: "https://nowpayments.io/payment/?iid=np-inv-1",
};

// ─── canAddManagedClient ──────────────────────────────────────────────────────

describe("canAddManagedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          managedClient: prisma.managedClient,
          subscription: prisma.subscription,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("STARTER con 4 RIFs activos → allowed:true, currentCount:4, limit:5", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(4 as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result).toEqual({ allowed: true, currentCount: 4, limit: 5 });
  });

  it("STARTER con 5 RIFs activos → allowed:false, currentCount:5, limit:5", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(5 as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result).toEqual({ allowed: false, currentCount: 5, limit: 5 });
  });

  it("PRO con 24 RIFs activos → allowed:true, currentCount:24, limit:25", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_PRO as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(24 as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result).toEqual({ allowed: true, currentCount: 24, limit: 25 });
  });

  it("PRO con 25 RIFs activos → allowed:false, currentCount:25, limit:25", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_PRO as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(25 as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result).toEqual({ allowed: false, currentCount: 25, limit: 25 });
  });

  it("UNLIMITED con 100 RIFs → allowed:true, currentCount:100, limit:null", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_UNLIMITED as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(100 as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result).toEqual({ allowed: true, currentCount: 100, limit: null });
  });

  it("sin Subscription (despachoTier null) → allowed:false", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null as never);
    // act
    const result = await canAddManagedClient(COMPANY_ID);
    // assert
    expect(result.allowed).toBe(false);
  });
});

// ─── addManagedClient ─────────────────────────────────────────────────────────

describe("addManagedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          managedClient: prisma.managedClient,
          subscription: prisma.subscription,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("happy path STARTER con cupo disponible → success:true con client", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.managedClient.create).mockResolvedValue(MANAGED_CLIENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // act
    const result = await addManagedClient(COMPANY_ID, BASE_INPUT, ACTOR_ID, IP, UA);
    // assert
    expect(result).toEqual({ success: true, client: MANAGED_CLIENT });
  });

  it("RIF inválido (sin prefijo VEN-NIF) → success:false, error contiene 'RIF inválido'", async () => {
    // arrange — el servicio valida RIF antes de ir al DB
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(1 as never);
    // act
    const result = await addManagedClient(
      COMPANY_ID,
      { ...BASE_INPUT, rif: "12345678" }, // sin prefijo
      ACTOR_ID, IP, UA
    );
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/RIF inválido/i);
    expect(prisma.managedClient.create).not.toHaveBeenCalled();
  });

  it("LL-001 regression — prefijo C- debe ser válido (RIF comunal con dígito verificador)", async () => {
    // arrange — VEN_RIF_REGEX incluye C (LL-001). Dígito verificador obligatorio desde Q3-5.
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.managedClient.create).mockResolvedValue({
      ...MANAGED_CLIENT,
      rif: "C-12345678-9",
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // act
    const result = await addManagedClient(
      COMPANY_ID,
      { ...BASE_INPUT, rif: "C-12345678-9" },
      ACTOR_ID, IP, UA
    );
    // assert
    expect(result).toMatchObject({ success: true });
  });

  it("RIF duplicado (P2002 @@unique) → success:false, error contiene 'Ya existe'", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(1 as never);
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.4.1",
      meta: { target: ["despachoCompanyId", "rif"] },
    });
    vi.mocked(prisma.managedClient.create).mockRejectedValue(p2002);
    // act
    const result = await addManagedClient(COMPANY_ID, BASE_INPUT, ACTOR_ID, IP, UA);
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/Ya existe/i);
  });

  it("sin cupo (límite alcanzado) → success:false, error contiene 'Límite'", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(5 as never); // en el límite
    // act
    const result = await addManagedClient(COMPANY_ID, BASE_INPUT, ACTOR_ID, IP, UA);
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/Límite/i);
    expect(prisma.managedClient.create).not.toHaveBeenCalled();
  });

  it("AuditLog creado en el mismo $transaction con action ADD_MANAGED_CLIENT", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.managedClient.create).mockResolvedValue(MANAGED_CLIENT as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // act
    await addManagedClient(COMPANY_ID, BASE_INPUT, ACTOR_ID, IP, UA);
    // assert — AuditLog debe ser llamado dentro del mismo $transaction
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ADD_MANAGED_CLIENT",
          companyId: COMPANY_ID,
          userId: ACTOR_ID,
          ipAddress: IP,
          userAgent: UA,
        }),
      })
    );
  });
});

// ─── archiveManagedClient ─────────────────────────────────────────────────────

describe("archiveManagedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          managedClient: prisma.managedClient,
          auditLog: prisma.auditLog,
        })) as never
    );
  });

  it("happy path → success:true y establece deletedAt + deletedBy", async () => {
    // arrange
    vi.mocked(prisma.managedClient.findFirst).mockResolvedValue(MANAGED_CLIENT as never);
    vi.mocked(prisma.managedClient.update).mockResolvedValue({
      ...MANAGED_CLIENT,
      deletedAt: new Date(),
      deletedBy: ACTOR_ID,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // act
    const result = await archiveManagedClient(COMPANY_ID, CLIENT_ID, ACTOR_ID, IP, UA);
    // assert
    expect(result).toEqual({ success: true });
    expect(prisma.managedClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedBy: ACTOR_ID,
        }),
      })
    );
  });

  it("IDOR: managedClientId de otro Despacho → success:false", async () => {
    // arrange — findFirst busca por id AND despachoCompanyId (LL-003 pattern)
    vi.mocked(prisma.managedClient.findFirst).mockResolvedValue(null as never); // no encontrado en este despacho
    // act
    const result = await archiveManagedClient(COMPANY_ID, CLIENT_ID, ACTOR_ID, IP, UA);
    // assert
    expect(result).toMatchObject({ success: false });
    expect(prisma.managedClient.update).not.toHaveBeenCalled();
  });

  it("registro ya archivado → success:false, error contiene 'ya archivado'", async () => {
    // arrange
    vi.mocked(prisma.managedClient.findFirst).mockResolvedValue({
      ...MANAGED_CLIENT,
      deletedAt: new Date(),
    } as never);
    // act
    const result = await archiveManagedClient(COMPANY_ID, CLIENT_ID, ACTOR_ID, IP, UA);
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/ya archivado/i);
  });
});

// ─── listManagedClients ───────────────────────────────────────────────────────

describe("listManagedClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna solo los clientes del despacho — ADR-004 aislamiento multi-tenant", async () => {
    // arrange
    vi.mocked(prisma.managedClient.findMany).mockResolvedValue([MANAGED_CLIENT] as never);
    // act
    await listManagedClients(COMPANY_ID);
    // assert — where DEBE incluir despachoCompanyId (ADR-004)
    expect(prisma.managedClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ despachoCompanyId: COMPANY_ID }),
      })
    );
  });

  it("excluye soft-deleted por defecto (deletedAt: null)", async () => {
    // arrange
    vi.mocked(prisma.managedClient.findMany).mockResolvedValue([MANAGED_CLIENT] as never);
    // act
    await listManagedClients(COMPANY_ID);
    // assert
    expect(prisma.managedClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it("con includeArchived:true NO filtra por deletedAt:null", async () => {
    // arrange
    vi.mocked(prisma.managedClient.findMany).mockResolvedValue([MANAGED_CLIENT] as never);
    // act
    await listManagedClients(COMPANY_ID, { includeArchived: true });
    // assert — el where no debe tener deletedAt:null
    expect(prisma.managedClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ deletedAt: null }),
      })
    );
  });
});

// ─── upgradeDespachoTier ──────────────────────────────────────────────────────

describe("upgradeDespachoTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          managedClient: prisma.managedClient,
          subscription: prisma.subscription,
          subscriptionPayment: prisma.subscriptionPayment,
          auditLog: prisma.auditLog,
        })) as never
    );
    vi.mocked(nowpayments.createNowPaymentsInvoice).mockResolvedValue(NP_INVOICE as never);
  });

  it("STARTER → PRO con count ≤ límite STARTER → success:true con paymentUrl", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_STARTER as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(3 as never);
    vi.mocked(prisma.subscriptionPayment.create).mockResolvedValue({ id: "payment-1" } as never);
    vi.mocked(prisma.subscriptionPayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    // act
    const result = await upgradeDespachoTier(COMPANY_ID, "PRO", ACTOR_ID);
    // assert
    expect(result).toMatchObject({ success: true });
    expect((result as { success: true; paymentUrl: string }).paymentUrl).toBeTruthy();
  });

  it("downgrade protegido: PRO → STARTER con count > 5 → success:false con error descriptivo", async () => {
    // arrange — 10 RIFs activos, no puede bajar a STARTER (límite 5)
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_PRO as never);
    vi.mocked(prisma.managedClient.count).mockResolvedValue(10 as never);
    // act
    const result = await upgradeDespachoTier(COMPANY_ID, "STARTER", ACTOR_ID);
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/10.*RIF|RIF.*10|STARTER/i);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("tier ya activo (PRO → PRO) → success:false, error contiene 'ya tienes'", async () => {
    // arrange
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(SUBSCRIPTION_PRO as never);
    // act
    const result = await upgradeDespachoTier(COMPANY_ID, "PRO", ACTOR_ID);
    // assert
    expect(result).toMatchObject({ success: false });
    expect((result as { success: false; error: string }).error).toMatch(/ya tienes/i);
  });
});
