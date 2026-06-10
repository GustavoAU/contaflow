// src/modules/retentions/actions/retention.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

vi.mock("@/lib/module-access", () => ({
  hasModuleAccess: vi.fn().mockResolvedValue(true),
  moduleAccessError: vi.fn().mockReturnValue("Módulo no habilitado"),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    retencion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    companyMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    fiscalYearClose: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    invoiceTaxLine: {
      findMany: vi.fn(),
    },
    vendor: {
      findMany: vi.fn(),
    },
    accountingPeriod: {
      findFirst: vi.fn(),
    },
    companySettings: {
      findUnique: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  fiscalKey: vi.fn((companyId: string, userId: string) => `${companyId}:${userId}`),
  limiters: { fiscal: {}, ocr: {} },
}));

vi.mock("@/lib/prisma-rls", () => ({
  withCompanyContext: vi.fn().mockImplementation(
    (_companyId: string, _tx: unknown, fn: (_tx: unknown) => unknown) => fn(_tx)
  ),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

vi.mock("@/modules/retentions/services/RetentionVoucherPDFService", () => ({
  generateRetentionVoucherPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

vi.mock("../services/RetentionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/RetentionService")>();
  return {
    ...actual,
    RetentionService: {
      ...actual.RetentionService,
      calculate: vi.fn().mockReturnValue({
        ivaAmount: "160.00",
        ivaRetention: "120.00",
        ivaRetentionPct: "75",
        islrAmount: null,
        islrRetentionPct: null,
        totalRetention: "120.00",
      }),
    },
    linkRetentionToInvoice: vi.fn(),
    getNextVoucherNumber: vi.fn().mockResolvedValue("CR-00000001"),
  };
});

import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateRetentionVoucherPDF } from "../services/RetentionVoucherPDFService";
import { linkRetentionToInvoice } from "../services/RetentionService";
import {
  createRetentionAction,
  getRetentionsAction,
  exportRetentionVoucherPDFAction,
  linkRetentionToInvoiceAction,
  findInvoiceByNumberAction,
  getActivePeriodAction,
} from "./retention.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_INPUT = {
  companyId: "company-1",
  providerName: "Distribuidora ABC C.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "B00000001",
  invoiceDate: new Date("2026-03-10"),
  invoiceAmount: "1160.00",
  taxBase: "1000.00",
  ivaAmount: "160.00",
  ivaRetentionPct: 75 as const,
  type: "IVA" as const,
  createdBy: "user-1",
};

const mockRetention = {
  id: "ret-1",
  companyId: "company-1",
  providerName: "Distribuidora ABC C.A.",
  providerRif: "J-12345678-9",
  invoiceNumber: "B00000001",
  invoiceDate: new Date("2026-03-10"),
  invoiceAmount: { toString: () => "1160.00" },
  taxBase: { toString: () => "1000.00" },
  ivaAmount: { toString: () => "160.00" },
  ivaRetention: { toString: () => "120.00" },
  ivaRetentionPct: { toString: () => "75" },
  islrAmount: null,
  islrRetentionPct: null,
  totalRetention: { toString: () => "120.00" },
  voucherNumber: "CR-00000001",
  type: "IVA",
  status: "PENDING",
  createdBy: "user-1",
  createdAt: new Date("2026-03-10"),
  deletedAt: null,
  idempotencyKey: "idem-key-1",
};

const mockCompany = {
  id: "company-1",
  name: "Empresa Test C.A.",
  rif: "J-12345678-9",
  address: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMembership = {
  id: "mem-1",
  userId: "user-1",
  companyId: "company-1",
  role: "ACCOUNTANT",
  company: mockCompany,
};

const mockRetentionFull = {
  ...mockRetention,
  company: mockCompany,
  taxBase: { toString: () => "1000.00", toFixed: () => "1000.00" },
  invoiceAmount: { toString: () => "1160.00", toFixed: () => "1160.00" },
  totalRetention: { toString: () => "120.00", toFixed: () => "120.00" },
  ivaRetentionPct: { toString: () => "75", toNumber: () => 75 },
  islrRetentionPct: null,
};

// ─── createRetentionAction ────────────────────────────────────────────────────

describe("createRetentionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null as never);
    // Por defecto: sin factura vinculada y sin cuentas GL → no genera asiento GL
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const tx = {
        retencion: {
          create: vi.mocked(prisma.retencion.create),
          update: vi.mocked(prisma.retencion.update),
        },
        auditLog: { create: vi.mocked(prisma.auditLog.create) },
        companySettings: { findUnique: vi.mocked(prisma.companySettings.findUnique) },
        transaction: { create: vi.mocked(prisma.transaction.create) },
        retentionSequence: { upsert: vi.fn().mockResolvedValue({ lastNumber: 1 }) },
      };
      return fn(tx as never);
    });
  });

  it("crea retención IVA correctamente en el happy path", async () => {
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.ivaRetention).toBe("120.00");
    expect(result.data.totalRetention).toBe("120.00");
    expect(result.data.voucherNumber).toBe("CR-00000001");
  });

  it("crea retención AMBAS (IVA + ISLR) correctamente", async () => {
    const mockAmbas = {
      ...mockRetention,
      islrAmount: { toString: () => "20.00" },
      islrRetentionPct: { toString: () => "2" },
      totalRetention: { toString: () => "140.00" },
      type: "AMBAS",
    };
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockAmbas as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      islrCode: "SERVICIOS_PJ",
      type: "AMBAS",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.islrAmount).toBe("20.00");
    expect(result.data.totalRetention).toBe("140.00");
  });

  it("falla con RIF inválido", async () => {
    const result = await createRetentionAction({
      ...VALID_INPUT,
      providerRif: "12345678", // sin prefijo
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("RIF");
  });

  it("rechaza retención en ejercicio económico cerrado", async () => {
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue({
      id: "fyc-1",
      year: 2026,
    } as never);

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain("cerrado");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Idempotencia — CRÍTICO-2 fix (LL-002) ────────────────────────────────
  it("retorna retención existente cuando idempotencyKey ya existe — fast path con companyId", async () => {
    // El beforeEach configura $transaction para ejecutarse siempre.
    // Este test necesita que findFirst retorne la existente ANTES de llegar a $transaction.
    // clearAllMocks() del beforeEach resetea los mocks — re-setear aquí explícitamente.
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetention as never);
    // Si el fast-path funciona, $transaction no debe ejecutarse
    vi.mocked(prisma.$transaction).mockClear();

    const result = await createRetentionAction({
      ...VALID_INPUT,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });

    if (!result.success) console.log("ERROR:", result.error);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("ret-1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.retencion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
          companyId: "company-1",
        }),
      })
    );
  });

  it("no hace fast path si idempotencyKey no está en el input", async () => {
    // Sin idempotencyKey → no busca existente, va directo a crear
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockRetention as never);

    const result = await createRetentionAction(VALID_INPUT); // sin idempotencyKey

    expect(prisma.retencion.findFirst).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  // ── Recovery path P2002 — CRÍTICO-3 fix ──────────────────────────────────
  it("recupera la retención existente en race condition P2002 — con companyId", async () => {
    // clearAllMocks() del beforeEach resetea findFirst — re-setear para el catch block.
    // $transaction lanza P2002, el catch busca la existente via findFirst.
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Error("Unique constraint failed — P2002")
    );
    // El recovery path en el catch llama findFirst — debe retornar la existente
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetention as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });

    if (!result.success) console.log("ERROR:", result.error);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe("ret-1");
    expect(prisma.retencion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
          companyId: "company-1",
        }),
      })
    );
  });

  it("retorna error cuando P2002 pero no hay idempotencyKey", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      new Error("Unique constraint failed — P2002")
    );

    const result = await createRetentionAction(VALID_INPUT); // sin idempotencyKey

    // Sin idempotencyKey el recovery path no aplica → retorna el error
    expect(result.success).toBe(false);
  });

  // ── GL: IVA incondicional (sin factura vinculada) ─────────────────────────
  it("GL-1: crea asiento Dr CxP / Cr Ret.IVA aunque no haya factura vinculada", async () => {
    // Configura cuentas GL — sin factura en BD
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      apAccountId: "acc-cxp",
      ivaRetentionPayableAccountId: "acc-ret-iva",
      islrRetentionPayableAccountId: null,
    } as never);
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.retencion.update).mockResolvedValue(mockRetention as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-gl-1" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createRetentionAction(VALID_INPUT);

    expect(result.success).toBe(true);
    // El asiento GL debe crearse aunque invoice.findFirst retornó null
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: "RET-CR-00000001",
          type: "DIARIO",
          entries: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ accountId: "acc-cxp" }),     // Dr CxP
              expect.objectContaining({ accountId: "acc-ret-iva" }), // Cr Ret.IVA
            ]),
          }),
        }),
      })
    );
    // transactionId vinculado al asiento GL de emisión
    expect(prisma.retencion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transactionId: "tx-gl-1" }),
      })
    );
  });

  // ── GL: ISLR ──────────────────────────────────────────────────────────────
  it("GL-2: crea asiento Dr CxP / Cr Ret.ISLR para retención tipo ISLR", async () => {
    vi.mocked(prisma.companySettings.findUnique).mockResolvedValue({
      apAccountId: "acc-cxp",
      ivaRetentionPayableAccountId: "acc-ret-iva",
      islrRetentionPayableAccountId: "acc-ret-islr",
    } as never);

    const mockCalcIslr = {
      taxBase: "1000.00",
      ivaAmount: "0.00",
      ivaRetention: "0.00",
      ivaRetentionPct: 0,
      islrAmount: "30.00",  // 3% de 1000
      islrRetentionPct: 3,
      incesAmount: null,
      incesRetentionPct: null,
      fatAmount: null,
      fatRetentionPct: null,
      totalRetention: "30.00",
    };

    const { RetentionService } = await import("../services/RetentionService");
    vi.mocked(RetentionService.calculate).mockReturnValueOnce(mockCalcIslr);

    const mockRetIslr = {
      ...mockRetention,
      type: "ISLR",
      ivaRetention: { toString: () => "0.00" },
      islrAmount: { toString: () => "30.00" },
      totalRetention: { toString: () => "30.00" },
    };
    vi.mocked(prisma.retencion.create).mockResolvedValue(mockRetIslr as never);
    vi.mocked(prisma.retencion.update).mockResolvedValue(mockRetIslr as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "tx-gl-islr" } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      type: "ISLR",
      islrCode: "HONORARIOS_PN",
    });

    expect(result.success).toBe(true);
    // Asiento solo tiene CxP y ISLR — NO IVA
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entries: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({ accountId: "acc-cxp" }),      // Dr CxP
              expect.objectContaining({ accountId: "acc-ret-islr" }), // Cr Ret.ISLR
            ]),
          }),
        }),
      })
    );
    // Cuenta de IVA NO debe aparecer en el asiento ISLR
    const callArgs = vi.mocked(prisma.transaction.create).mock.calls[0]?.[0];
    const entries = (callArgs?.data as { entries?: { create?: { accountId: string }[] } })?.entries?.create ?? [];
    expect(entries.some((e) => e.accountId === "acc-ret-iva")).toBe(false);
  });
});

// ─── getRetentionsAction ──────────────────────────────────────────────────────

describe("getRetentionsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue({ role: "ACCOUNTANT" } as never);
  });

  it("retorna lista de retenciones de la empresa", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([mockRetention] as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].providerRif).toBe("J-12345678-9");
  });

  it("retorna lista vacía si no hay retenciones", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(0);
  });

  it("serializa campos Decimal a string", async () => {
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([mockRetention] as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(typeof result.data[0].invoiceAmount).toBe("string");
    expect(typeof result.data[0].totalRetention).toBe("string");
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(prisma.retencion.findMany).not.toHaveBeenCalled();
  });

  it("retorna { success: false } si el usuario no es miembro de la empresa", async () => {
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(null as never);

    const result = await getRetentionsAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(prisma.retencion.findMany).not.toHaveBeenCalled();
  });
});

// ─── exportRetentionVoucherPDFAction ─────────────────────────────────────────

describe("exportRetentionVoucherPDFAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesion autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si membership no encontrado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("retorna error si retención no encontrada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(null);

    const result = await exportRetentionVoucherPDFAction("ret-999", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Retención no encontrada");
  });

  it("happy path: retorna buffer PDF serializable", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(mockRetentionFull as never);
    vi.mocked(generateRetentionVoucherPDF).mockResolvedValue(Buffer.from("fake-pdf"));

    const result = await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.buffer).toEqual(expect.any(Array));
      expect(result.buffer.length).toBeGreaterThan(0);
    }
    expect(generateRetentionVoucherPDF).toHaveBeenCalledOnce();
  });

  it("usa retention.id como fallback si voucherNumber es null", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(
      { ...mockRetentionFull, voucherNumber: null } as never
    );
    vi.mocked(generateRetentionVoucherPDF).mockResolvedValue(Buffer.from("fake-pdf"));

    await exportRetentionVoucherPDFAction("ret-1", "company-1");

    expect(generateRetentionVoucherPDF).toHaveBeenCalledWith(
      expect.objectContaining({ voucherNumber: "ret-1" })
    );
  });
});

// ─── linkRetentionToInvoiceAction ─────────────────────────────────────────────

describe("linkRetentionToInvoiceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesion autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si membership no encontrado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("happy path: vincula retención y llama revalidatePath", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(linkRetentionToInvoice).mockResolvedValue({} as never);

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/accounting/retentions");
    expect(linkRetentionToInvoice).toHaveBeenCalledWith("ret-1", "inv-1", "company-1", null, null);
  });

  it("retorna error de negocio cuando P2002 — ya vinculada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(linkRetentionToInvoice).mockRejectedValue(
      new Error("Unique constraint failed — P2002")
    );

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-1", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya está vinculada");
  });

  it("retorna error de negocio cuando P2003 — factura o retención inválida", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(linkRetentionToInvoice).mockRejectedValue(
      new Error("Foreign key constraint — P2003")
    );

    const result = await linkRetentionToInvoiceAction("ret-1", "inv-inexistente", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no válida");
  });
});

// ─── findInvoiceByNumberAction ────────────────────────────────────────────────

describe("findInvoiceByNumberAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna error si no hay sesion autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await findInvoiceByNumberAction("B0001", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("retorna error si membership no encontrado", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);

    const result = await findInvoiceByNumberAction("B0001", "company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("happy path: retorna facturas con isVendorSpecialContributor y hasLinkedRetention", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      {
        id: "inv-1",
        invoiceNumber: "B00000001",
        date: new Date("2026-03-10"),
        counterpartName: "Proveedor ABC",
        counterpartRif: "J-12345678-9",
        type: "PURCHASE",
      },
    ] as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await findInvoiceByNumberAction("B0001", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].invoiceNumber).toBe("B00000001");
    expect(result.data[0].isVendorSpecialContributor).toBe(false);
    expect(result.data[0].hasLinkedRetention).toBe(false);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "company-1" }),
      })
    );
  });

  it("retorna array vacío si no hay coincidencias", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    const result = await findInvoiceByNumberAction("INEXISTENTE", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(0);
  });

  // ── ALERTA 17: isVendorSpecialContributor ─────────────────────────────────
  it("ALERTA 17: retorna isVendorSpecialContributor=true cuando el proveedor es CE", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "inv-1", invoiceNumber: "B00000001", date: new Date(), counterpartName: "CE Corp", counterpartRif: "J-99887766-5", type: "PURCHASE" },
    ] as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([
      { rif: "J-99887766-5", isSpecialContributor: true },
    ] as never);
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await findInvoiceByNumberAction("B0001", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].isVendorSpecialContributor).toBe(true);
  });

  it("ALERTA 17: retorna isVendorSpecialContributor=false cuando el proveedor no es CE", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "inv-2", invoiceNumber: "B00000002", date: new Date(), counterpartName: "Normal Corp", counterpartRif: "J-11223344-5", type: "PURCHASE" },
    ] as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([
      { rif: "J-11223344-5", isSpecialContributor: false },
    ] as never);
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await findInvoiceByNumberAction("B0002", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].isVendorSpecialContributor).toBe(false);
  });

  // ── ALERTA 19: hasLinkedRetention ─────────────────────────────────────────
  it("ALERTA 19: retorna hasLinkedRetention=true cuando la factura ya tiene retención", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "inv-3", invoiceNumber: "B00000003", date: new Date(), counterpartName: "Corp X", counterpartRif: "J-12345678-9", type: "PURCHASE" },
    ] as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([
      { invoiceId: "inv-3" },
    ] as never);

    const result = await findInvoiceByNumberAction("B0003", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].hasLinkedRetention).toBe(true);
  });

  it("ALERTA 19: retorna hasLinkedRetention=false cuando la factura no tiene retención", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      { id: "inv-4", invoiceNumber: "B00000004", date: new Date(), counterpartName: "Corp Y", counterpartRif: "J-12345678-9", type: "PURCHASE" },
    ] as never);
    vi.mocked(prisma.vendor.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.retencion.findMany).mockResolvedValue([] as never);

    const result = await findInvoiceByNumberAction("B0004", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data[0].hasLinkedRetention).toBe(false);
  });
});

// ─── ALERTA 20: createRetentionAction — validación de período ────────────────

describe("createRetentionAction — ALERTA 20: período contable activo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          retencion: prisma.retencion,
          auditLog: prisma.auditLog,
          companySettings: { findUnique: vi.fn().mockResolvedValue(null) },
          transaction: { create: vi.fn() },
        })) as never
    );
    vi.mocked(prisma.retencion.create).mockResolvedValue({
      ...mockRetention,
      enteradoAt: null,
      incesAmount: null,
      fatAmount: null,
      ivaRetentionPct: { toString: () => "75" },
      islrAmount: null,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("ALERTA 20: rechaza retención cuando la fecha está fuera del período activo", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      year: 2026,
      month: 3, // período activo: marzo 2026
    } as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      invoiceDate: new Date("2026-02-15"), // febrero — fuera del período activo
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("fuera del período contable activo");
      expect(result.error).toContain("03/2026");
    }
  });

  it("ALERTA 20: permite retención cuando la fecha está dentro del período activo", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      year: 2026,
      month: 3, // período activo: marzo 2026
    } as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      invoiceDate: new Date("2026-03-10"), // marzo — dentro del período activo
    });

    expect(result.success).toBe(true);
  });

  it("ALERTA 20: permite retención cuando no hay período activo (empresa sin período configurado)", async () => {
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      invoiceDate: new Date("2025-06-01"), // fecha arbitraria, sin período que la bloquee
    });

    expect(result.success).toBe(true);
  });
});

// ─── getActivePeriodAction ────────────────────────────────────────────────────

describe("getActivePeriodAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retorna el período activo cuando existe", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue({
      year: 2026,
      month: 3,
    } as never);

    const result = await getActivePeriodAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ year: 2026, month: 3 });
  });

  it("retorna null cuando no hay período activo", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null);

    const result = await getActivePeriodAction("company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBeNull();
  });

  it("retorna error si no hay sesión autenticada", async () => {
    vi.mocked(auth).mockResolvedValue({ userId: null } as never);

    const result = await getActivePeriodAction("company-1");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });
});

// ─── ALERTA 18: createRetentionAction — validación base imponible vs factura ──

describe("createRetentionAction — ALERTA 18: validación base imponible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.companyMember.findUnique).mockResolvedValue(mockMembership as never);
    vi.mocked(prisma.fiscalYearClose.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.accountingPeriod.findFirst).mockResolvedValue(null); // sin restricción de período
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) =>
        fn({
          retencion: prisma.retencion,
          auditLog: prisma.auditLog,
          companySettings: { findUnique: vi.fn().mockResolvedValue(null) },
          transaction: { create: vi.fn() },
        })) as never
    );
    vi.mocked(prisma.retencion.create).mockResolvedValue({
      ...mockRetention,
      enteradoAt: null,
      incesAmount: null,
      fatAmount: null,
      ivaRetentionPct: { toString: () => "75" },
      islrAmount: null,
    } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  });

  it("ALERTA 18: rechaza cuando taxBase de retención supera la base de la factura registrada", async () => {
    // Factura en BD con base imponible de 1000
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      invoiceNumber: "B00000001",
      taxLines: [
        { base: { toString: () => "800.00" } },
        { base: { toString: () => "200.00" } },
      ],
    } as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      taxBase: "1500.00", // excede los 1000 de la factura en más de 1 Bs
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("supera la base imponible registrada");
      expect(result.error).toContain("B00000001");
    }
  });

  it("ALERTA 18: permite cuando taxBase está dentro de la base de la factura (con tolerancia)", async () => {
    // Factura en BD con base imponible de 1000
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({
      invoiceNumber: "B00000001",
      taxLines: [{ base: { toString: () => "1000.00" } }],
    } as never);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      taxBase: "1000.50", // 0.50 Bs de diferencia → dentro de la tolerancia de 1 Bs
    });

    expect(result.success).toBe(true);
  });

  it("ALERTA 18: permite cuando la factura no está en el sistema (retención manual)", async () => {
    // Factura no encontrada en BD — flujo manual permitido
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

    const result = await createRetentionAction({
      ...VALID_INPUT,
      taxBase: "9999.00", // cualquier monto — sin factura en BD no hay restricción
    });

    expect(result.success).toBe(true);
  });
});
