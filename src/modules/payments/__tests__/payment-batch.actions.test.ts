import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
  },
}));
vi.mock("../services/PaymentBatchService", () => ({
  PaymentBatchService: {
    createBatch: vi.fn(),
    applyBatch: vi.fn(),
    voidBatch: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import {
  createPaymentBatchAction,
  applyPaymentBatchAction,
  voidPaymentBatchAction,
  getPaymentBatchAction,
  listPaymentBatchesAction,
} from "../actions/payment-batch.actions";
import { PaymentBatchService } from "../services/PaymentBatchService";

const COMPANY_ID = "company-1";
const USER_ID = "user-1";
const BATCH_ID = "batch-1";
const MEMBER = { userId: USER_ID, companyId: COMPANY_ID, role: "ACCOUNTANT" };

const BATCH_SUMMARY = {
  id: BATCH_ID,
  companyId: COMPANY_ID,
  status: "DRAFT" as const,
  method: "TRANSFERENCIA" as const,
  totalAmountVes: "500000.0000",
  currency: "VES",
  totalAmountOriginal: null,
  exchangeRateId: null,
  referenceNumber: "REF-001",
  originBank: "Banesco",
  destBank: "BDV",
  commissionPct: null,
  commissionAmount: null,
  totalIgtfAmount: null,
  date: new Date("2026-05-01"),
  notes: null,
  voidReason: null,
  voidedAt: null,
  voidedBy: null,
  createdAt: new Date("2026-05-01"),
  createdBy: USER_ID,
  idempotencyKey: "idem-key-1",
  lines: [
    { id: "line-1", invoiceId: "inv-a", invoiceNumber: "TCOMP-001", counterpartName: "Proveedor A", amountVes: "150000.0000", amountOriginal: null, igtfAmount: null, notes: null },
    { id: "line-2", invoiceId: "inv-b", invoiceNumber: "TCOMP-002", counterpartName: "Proveedor B", amountVes: "350000.0000", amountOriginal: null, igtfAmount: null, notes: null },
  ],
};

const VALID_CREATE_INPUT = {
  companyId: COMPANY_ID,
  method: "TRANSFERENCIA" as const,
  totalAmountVes: "500000.0000",
  date: "2026-05-01",
  idempotencyKey: "idem-key-1",
  lines: [
    { invoiceId: "inv-a", amountVes: "150000.0000" },
    { invoiceId: "inv-b", amountVes: "350000.0000" },
  ],
};

function setupOk() {
  mockAuth.mockResolvedValue({ userId: USER_ID });
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
}

// ─── createPaymentBatchAction ─────────────────────────────────────────────────

describe("createPaymentBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupOk();
    vi.mocked(PaymentBatchService.createBatch).mockResolvedValue(BATCH_SUMMARY);
  });

  it("happy path — retorna batch DRAFT", async () => {
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("DRAFT");
    expect(PaymentBatchService.createBatch).toHaveBeenCalledOnce();
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/No autorizado/);
  });

  it("retorna error si rate limit excedido", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/solicitudes/);
  });

  it("retorna error si usuario no es miembro de la empresa (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no encontrada|acceso denegado/);
  });

  it("retorna error si usuario no tiene permisos (VIEWER)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue({
      ...MEMBER,
      role: "VIEWER",
    } as never);
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/No autorizado/);
  });

  it("retorna error de validación Zod si líneas vacías", async () => {
    const result = await createPaymentBatchAction({ ...VALID_CREATE_INPUT, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/línea/);
  });

  it("retorna error de validación Zod si fecha inválida", async () => {
    const result = await createPaymentBatchAction({ ...VALID_CREATE_INPUT, date: "01-05-2026" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Fecha inválida/);
  });

  it("retorna error de validación si PagoMóvil sin referencia", async () => {
    const result = await createPaymentBatchAction({
      ...VALID_CREATE_INPUT,
      method: "PAGOMOVIL",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/referencia/i);
  });

  it("propaga error de negocio del service", async () => {
    vi.mocked(PaymentBatchService.createBatch).mockRejectedValue(
      new Error("Factura inv-a ya está completamente pagada")
    );
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/pagada/);
  });

  it("sanitiza errores técnicos de Prisma", async () => {
    vi.mocked(PaymentBatchService.createBatch).mockRejectedValue(
      new Error("Prisma client error")
    );
    const result = await createPaymentBatchAction(VALID_CREATE_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).not.toMatch(/Prisma/);
  });
});

// ─── applyPaymentBatchAction ──────────────────────────────────────────────────

describe("applyPaymentBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupOk();
    vi.mocked(PaymentBatchService.applyBatch).mockResolvedValue({
      ...BATCH_SUMMARY,
      status: "APPLIED",
    });
  });

  it("happy path — retorna batch APPLIED", async () => {
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: BATCH_ID });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("APPLIED");
    expect(PaymentBatchService.applyBatch).toHaveBeenCalledOnce();
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: BATCH_ID });
    expect(result.success).toBe(false);
  });

  it("retorna error si usuario no es miembro (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: BATCH_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no encontrada|acceso denegado/);
  });

  it("retorna error de validación si batchId vacío", async () => {
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: "" });
    expect(result.success).toBe(false);
  });

  it("propaga error de negocio del service (sobrepago)", async () => {
    vi.mocked(PaymentBatchService.applyBatch).mockRejectedValue(
      new Error("El monto de la línea excede el saldo pendiente")
    );
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: BATCH_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/excede/);
  });

  it("propaga error de concurrencia P2034 del service", async () => {
    vi.mocked(PaymentBatchService.applyBatch).mockRejectedValue(
      new Error("Conflicto de concurrencia — reintente la operación")
    );
    const result = await applyPaymentBatchAction({ companyId: COMPANY_ID, batchId: BATCH_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Conflicto/);
  });
});

// ─── voidPaymentBatchAction ───────────────────────────────────────────────────

describe("voidPaymentBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupOk();
    vi.mocked(PaymentBatchService.voidBatch).mockResolvedValue({
      ...BATCH_SUMMARY,
      status: "VOID",
    });
  });

  it("happy path — retorna batch VOID", async () => {
    const result = await voidPaymentBatchAction({
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      voidReason: "Error en referencia",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("VOID");
    expect(PaymentBatchService.voidBatch).toHaveBeenCalledOnce();
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await voidPaymentBatchAction({
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      voidReason: "Motivo",
    });
    expect(result.success).toBe(false);
  });

  it("retorna error de validación si voidReason vacío (Zod)", async () => {
    const result = await voidPaymentBatchAction({
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      voidReason: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/voidReason/i);
  });

  it("retorna error si usuario no es miembro (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await voidPaymentBatchAction({
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      voidReason: "Motivo",
    });
    expect(result.success).toBe(false);
  });

  it("propaga error de negocio — batch no en APPLIED", async () => {
    vi.mocked(PaymentBatchService.voidBatch).mockRejectedValue(
      new Error("Solo se pueden anular lotes APPLIED")
    );
    const result = await voidPaymentBatchAction({
      companyId: COMPANY_ID,
      batchId: BATCH_ID,
      voidReason: "Motivo",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/APPLIED/);
  });
});

// ─── getPaymentBatchAction ────────────────────────────────────────────────────

describe("getPaymentBatchAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
  });

  it("retorna batch si encontrado", async () => {
    vi.mocked(PaymentBatchService.getById).mockResolvedValue(BATCH_SUMMARY);
    const result = await getPaymentBatchAction(COMPANY_ID, BATCH_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data?.id).toBe(BATCH_ID);
  });

  it("retorna null si no encontrado", async () => {
    vi.mocked(PaymentBatchService.getById).mockResolvedValue(null);
    const result = await getPaymentBatchAction(COMPANY_ID, "nope");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await getPaymentBatchAction(COMPANY_ID, BATCH_ID);
    expect(result.success).toBe(false);
  });
});

// ─── listPaymentBatchesAction ─────────────────────────────────────────────────

describe("listPaymentBatchesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER as never);
  });

  it("retorna lista paginada", async () => {
    vi.mocked(PaymentBatchService.list).mockResolvedValue({
      batches: [BATCH_SUMMARY],
      nextCursor: null,
    });
    const result = await listPaymentBatchesAction(COMPANY_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batches).toHaveLength(1);
      expect(result.data.nextCursor).toBeNull();
    }
  });

  it("pasa cursor al service", async () => {
    vi.mocked(PaymentBatchService.list).mockResolvedValue({ batches: [], nextCursor: null });
    await listPaymentBatchesAction(COMPANY_ID, "cursor-abc");
    expect(PaymentBatchService.list).toHaveBeenCalledWith(COMPANY_ID, "cursor-abc");
  });

  it("retorna error si no autenticado", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const result = await listPaymentBatchesAction(COMPANY_ID);
    expect(result.success).toBe(false);
  });

  it("retorna error si usuario no es miembro (ADR-004)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null);
    const result = await listPaymentBatchesAction(COMPANY_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/no encontrada|acceso denegado/);
  });
});
