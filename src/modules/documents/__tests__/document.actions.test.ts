// src/modules/documents/__tests__/document.actions.test.ts
// Q3-1: Tests de seguridad y funcionalidad para document.actions
// M6: revocación de share links (jti + DocShareToken)

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
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/document-share-jwt", () => ({
  signDocShareToken: mockSignDocShareToken,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember:  { findFirst: vi.fn() },
    invoice:        { findFirst: vi.fn() },
    retencion:      { findFirst: vi.fn() },
    docShareToken:  { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditLog:       { create: vi.fn() },
    $transaction:   vi.fn(),
  },
}));
vi.mock("../services/DocumentService", () => ({
  DocumentService: { list: vi.fn() },
}));

import prisma from "@/lib/prisma";
import {
  listDocumentsAction,
  generateDocShareTokenAction,
  revokeDocShareTokenAction,
} from "../actions/document.actions";
import { DocumentService } from "../services/DocumentService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const COMPANY_ID = "company-abc";
const USER_ID    = "user-xyz";
const DOC_ID     = "doc-001";
const TEST_JTI   = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const MEMBER_ACCOUNTING = { role: "ACCOUNTANT" };
const MEMBER_VIEWER     = { role: "VIEWER" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  process.env.NEXT_PUBLIC_APP_URL = "https://app.contaflow.io";
  // $transaction ejecuta ambas operaciones en secuencia (mock batch array)
  vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}] as never);
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
    vi.mocked(DocumentService.list).mockResolvedValue({ items: fakeItems, total: 1 });

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
    mockSignDocShareToken.mockReturnValue({ token: "signed-jwt-token", jti: TEST_JTI });

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
    mockSignDocShareToken.mockReturnValue({ token: "retention-jwt-token", jti: TEST_JTI });

    const res = await generateDocShareTokenAction(COMPANY_ID, "RETENTION", DOC_ID);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.url).toContain("/api/doc/retention-jwt-token");
    }
  });

  it("persiste DocShareToken + AuditLog DOC_SHARED en $transaction", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    mockSignDocShareToken.mockReturnValue({ token: "tok", jti: TEST_JTI });

    await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);

    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
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

  it("devuelve error estructurado si $transaction lanza excepción", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: DOC_ID } as never);
    mockSignDocShareToken.mockReturnValue({ token: "tok", jti: TEST_JTI });
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("write failed"));

    const res = await generateDocShareTokenAction(COMPANY_ID, "INVOICE", DOC_ID);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBeTruthy();
  });
});

// ─── revokeDocShareTokenAction (M6) ──────────────────────────────────────────

describe("revokeDocShareTokenAction", () => {
  it("retorna error 'No autorizado' si no hay userId", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si el usuario no es miembro", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/acceso denegado/i);
  });

  it("retorna error si VIEWER intenta revocar (requiere ACCOUNTANT+)", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_VIEWER as never);

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autorizado");
  });

  it("retorna error si el token no existe", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.docShareToken.findFirst).mockResolvedValue(null as never);

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Token no encontrado");
  });

  it("retorna error si el token ya fue revocado", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.docShareToken.findFirst).mockResolvedValue({
      id: "dst-1",
      revokedAt: new Date("2026-06-10"),
    } as never);

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/ya estaba revocado/i);
  });

  it("revoca el token y retorna { revoked: true }", async () => {
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(MEMBER_ACCOUNTING as never);
    vi.mocked(prisma.docShareToken.findFirst).mockResolvedValue({
      id: "dst-1",
      revokedAt: null,
    } as never);

    const res = await revokeDocShareTokenAction(COMPANY_ID, TEST_JTI);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.revoked).toBe(true);
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
  });
});
