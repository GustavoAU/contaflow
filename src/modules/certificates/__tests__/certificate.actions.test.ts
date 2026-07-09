// src/modules/certificates/__tests__/certificate.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockAuth = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  fiscalKey: (c: string, u: string) => `${c}:${u}`,
  limiters: { fiscal: {}, ocr: {} },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
    companyCertificate: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../services/CertificateService", () => ({
  CertificateService: {
    generateSelfSigned: vi.fn(),
    loadOfficialCertificate: vi.fn(),
    getCertificateStatus: vi.fn(),
  },
  decryptCertificate: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { CertificateService } from "../services/CertificateService";
import {
  generateDemoCertificateAction,
  uploadOfficialCertificateAction,
  getCertificateStatusAction,
} from "../actions/certificate.actions";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-1";
const USER_ID = "user-1";

const ADMIN_MEMBER = { role: "ADMIN" };
const ACCOUNTANT_MEMBER = { role: "ACCOUNTANT" };
const VIEWER_MEMBER = { role: "VIEWER" };

const MOCK_COMPANY = { name: "Empresa Test C.A.", rif: "J-12345678-9" };

const MOCK_CERT_RESULT = {
  thumbprint: "a".repeat(64),
  expiresAt: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
  isSelfSigned: true as const,
};

const VALID_P12_BASE64 = Buffer.from("fakep12content").toString("base64");

// ─── generateDemoCertificateAction ────────────────────────────────────────────

describe("generateDemoCertificateAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue(MOCK_COMPANY as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({})) as never,
    );
    vi.mocked(CertificateService.generateSelfSigned).mockResolvedValue(MOCK_CERT_RESULT);
  });

  it("rechaza si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(CertificateService.generateSelfSigned).not.toHaveBeenCalled();
  });

  it("rechaza si rate limit agotado", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, error: "Demasiadas solicitudes" });

    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    expect(CertificateService.generateSelfSigned).not.toHaveBeenCalled();
  });

  it("rechaza si role !== ADMIN (ACCOUNTANT no puede)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);

    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
    expect(CertificateService.generateSelfSigned).not.toHaveBeenCalled();
  });

  it("rechaza si ya existe certificado (propagado desde el servicio)", async () => {
    vi.mocked(CertificateService.generateSelfSigned).mockRejectedValue(
      new Error("La empresa ya tiene un certificado activo."),
    );

    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya tiene un certificado activo");
  });

  it("respuesta no contiene p12 ni clave privada", async () => {
    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("p12Buffer");
      expect(result.data).not.toHaveProperty("encryptedP12");
      expect(result.data).not.toHaveProperty("privateKey");
      expect(result.data.thumbprint).toBeDefined();
    }
  });

  it("happy path: ADMIN genera certificado demo", async () => {
    const result = await generateDemoCertificateAction({ companyId: COMPANY_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isSelfSigned).toBe(true);
      expect(result.data.thumbprint).toHaveLength(64);
    }
  });
});

// ─── uploadOfficialCertificateAction ──────────────────────────────────────────

describe("uploadOfficialCertificateAction", () => {
  const MOCK_OFFICIAL_RESULT = {
    thumbprint: "b".repeat(64),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    issuedBy: "PSC World",
    isSelfSigned: false as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ADMIN_MEMBER as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      ((fn: (tx: unknown) => unknown) => fn({})) as never,
    );
    vi.mocked(CertificateService.loadOfficialCertificate).mockResolvedValue(MOCK_OFFICIAL_RESULT);
  });

  it("rechaza si role !== ADMIN", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);

    const result = await uploadOfficialCertificateAction({
      companyId: COMPANY_ID,
      p12Base64: VALID_P12_BASE64,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("rechaza p12Base64 que supera 100 KB (en tamaño real del buffer)", async () => {
    // Buffer > 100KB → base64 > 136KB
    const bigBuffer = Buffer.alloc(110_000, "x");
    const bigBase64 = bigBuffer.toString("base64");

    const result = await uploadOfficialCertificateAction({
      companyId: COMPANY_ID,
      p12Base64: bigBase64,
    });

    expect(result.success).toBe(false);
  });

  it("rechaza base64 que no es PKCS#12 válido (propagado desde servicio)", async () => {
    vi.mocked(CertificateService.loadOfficialCertificate).mockRejectedValue(
      new Error("El archivo .p12 no es válido"),
    );

    const result = await uploadOfficialCertificateAction({
      companyId: COMPANY_ID,
      p12Base64: VALID_P12_BASE64,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain(".p12 no es válido");
  });

  it("respuesta no contiene p12 ni clave privada", async () => {
    const result = await uploadOfficialCertificateAction({
      companyId: COMPANY_ID,
      p12Base64: VALID_P12_BASE64,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("encryptedP12");
      expect(result.data).not.toHaveProperty("p12Buffer");
      expect(result.data.thumbprint).toBeDefined();
      expect(result.data.isSelfSigned).toBe(false);
    }
  });
});

// ─── getCertificateStatusAction ────────────────────────────────────────────────

describe("getCertificateStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: USER_ID });
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(ACCOUNTANT_MEMBER as never);
    vi.mocked(CertificateService.getCertificateStatus).mockResolvedValue({
      exists: true,
      thumbprint: "c".repeat(64),
      isSelfSigned: true,
    });
  });

  it("retorna { success: false } si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const result = await getCertificateStatusAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(false);
  });

  it("accesible por ACCOUNTANT", async () => {
    const result = await getCertificateStatusAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(true);
  });

  it("rechaza VIEWER", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(VIEWER_MEMBER as never);

    const result = await getCertificateStatusAction({ companyId: COMPANY_ID });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No autorizado");
  });

  it("IDOR: rechaza companyId de otra empresa (no miembro)", async () => {
    vi.mocked(prisma.companyMember.findFirst).mockResolvedValue(null as never);

    const result = await getCertificateStatusAction({ companyId: "otra-empresa-id" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
    expect(CertificateService.getCertificateStatus).not.toHaveBeenCalled();
  });
});
