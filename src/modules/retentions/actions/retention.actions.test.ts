// src/modules/retentions/actions/retention.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    retencion: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
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
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const tx = {
        retencion: { create: vi.mocked(prisma.retencion.create) },
        auditLog: { create: vi.mocked(prisma.auditLog.create) },
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
});

// ─── getRetentionsAction ──────────────────────────────────────────────────────

describe("getRetentionsAction", () => {
  beforeEach(() => vi.clearAllMocks());

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
    expect(linkRetentionToInvoice).toHaveBeenCalledWith("ret-1", "inv-1", "company-1");
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

  it("happy path: retorna facturas que coinciden con el número", async () => {
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

    const result = await findInvoiceByNumberAction("B0001", "company-1");

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].invoiceNumber).toBe("B00000001");
    // Verificar que busca con companyId — aislamiento multi-tenant
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
});
