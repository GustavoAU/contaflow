// src/modules/documents/__tests__/document.actions.test.ts
// Q3-1: Tests de seguridad y funcionalidad para document.actions

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());
const mockSignDocShareToken = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/document-share-jwt", () => ({
  signDocShareToken: mockSignDocShareToken,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    invoice:       { findFirst: vi.fn() },
    retencion:     { findFirst: vi.fn() },
    auditLog:      { create: vi.fn() },
  },
}));
vi.mock("../services/DocumentService", () => ({
  DocumentService: {
    list: vi.fn(),
  },
}));

import prisma from "@/lib/prisma";
import { listDocumentsAction, generateDocShareTokenAction } from "../actions/document.actions";
import { DocumentService } from "../services/DocumentService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-abc";
const USER_ID    = "user-xyz";
const DOC_ID     = "doc-001";

const MEMBER_ACCOUNTING = { role: "ACCOUNTANT" };
const MEMBER_VIEWER     = { role: "VIEWER" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  process.env.NEXT_PUBLIC_APP_URL = "https://app.contaflow.io";
});

// ─── listDocumentsAction ──────────────────────────────────────────────────────

describe("listDocumentsAction", () => {
  it("retorna error 'No autorizado' si no hay userId", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await listDocumentsAction(COMPANY_ID, {});
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si el usuario no es miembro de la empresa", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const res = await listDocumentsAction(COMPANY_ID, {});
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/acceso denegado/i);
  });

  it("retorna error si los filtros son inválidos (search > 100 chars)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);

    const res = await listDocumentsAction(COMPANY_ID, { search: "x".repeat(101) });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Filtros inválidos");
  });

  it("llama a DocumentService.list y retorna items + total + page", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);

    const fakeItems = [
      {
        id: DOC_ID,
        documentType: "FACTURA_VENTA" as const,
        number: "0001-000123",
        counterpart: "Cliente S.A.",
        date: new Date("2026-04-01"),
        amountVes: "500.00",
        currency: "VES",
      },
    ];
    vi.mocked(DocumentService.list).mockResolvedValue({
      items: fakeItems,
      total: 1,
    });

    const res = await listDocumentsAction(COMPANY_ID, { page: 1, search: "Cliente" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.total).toBe(1);
      expect(res.data.items).toHaveLength(1);
      expect(res.data.page).toBe(1);
    }
  });

  it("VIEWER también puede listar documentos (ROLES.ALL)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_VIEWER as never);
    vi.mocked(DocumentService.list).mockResolvedValue({ items: [], total: 0 });

    const res = await listDocumentsAction(COMPANY_ID, {});
    expect(res.success).toBe(true);
  });

  it("devuelve error estructurado si DocumentService.list lanza excepción", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(DocumentService.list).mockRejectedValueOnce(new Error("DB no disponible"));

    const res = await listDocumentsAction(COMPANY_ID, {});
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBeTruthy();
  });
});

// ─── generateDocShareTokenAction ──────────────────────────────────────────────

describe("generateDocShareTokenAction", () => {
  it("retorna error 'No autorizado' si no hay userId", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si el rate limit está excedido", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/demasiadas solicitudes/i);
  });

  it("retorna error si el usuario no es ACCOUNTANT o superior (VIEWER no puede compartir)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_VIEWER as never);

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si la factura no pertenece a la empresa (guard cross-tenant ADR-004)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never);

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Documento no encontrado");
  });

  it("retorna error si la retención no pertenece a la empresa (guard cross-tenant ADR-004)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue(null as never);

    const res = await generateDocShareTokenAction(COMPANY_ID, "RETENTION", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Documento no encontrado");
  });

  it("genera token y URL para una factura válida", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockSignDocShareToken.mockReturnValue("signed-jwt-token");

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.url).toBe("https://app.contaflow.io/api/doc/signed-jwt-token");
      expect(res.data.expiresAt).toBeTruthy();
    }
  });

  it("genera token y URL para una retención válida", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.retencion.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockSignDocShareToken.mockReturnValue("retention-jwt-token");

    const res = await generateDocShareTokenAction(COMPANY_ID, "RETENTION", DOC_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.url).toContain("/api/doc/retention-jwt-token");
    }
  });

  it("registra AuditLog con acción DOC_SHARED", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
    mockSignDocShareToken.mockReturnValue("tok");

    await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);

    expect(vi.mocked(prisma.auditLog.create)).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.auditLog.create).mock.calls[0][0];
    expect(call.data.action).toBe("DOC_SHARED");
    expect(call.data.entityId).toBe(DOC_ID);
    expect(call.data.companyId).toBe(COMPANY_ID);
    expect(call.data.userId).toBe(USER_ID);
  });

  it("retorna error para tipo de documento inválido", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);

    const res = await generateDocShareTokenAction(
      COMPANY_ID,
      "INVALID_TYPE" as "INVOICE" | "RETENTION",
      DOC_ID,
    );
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Tipo de documento inválido");
  });

  it("devuelve error estructurado si auditLog.create lanza excepción", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    mockSignDocShareToken.mockReturnValue("tok");
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error("write failed"));

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBeTruthy();
  });
});
