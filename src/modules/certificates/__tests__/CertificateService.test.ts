// src/modules/certificates/__tests__/CertificateService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks hoisted ────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  default: {
    companyCertificate: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

// Mock node-forge para evitar generación RSA lenta en tests
vi.mock("node-forge", () => {
  const fakeCert = {
    publicKey: null,
    serialNumber: "deadbeef01020304",
    validity: {
      notBefore: new Date(),
      notAfter: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
    },
    subject: {
      getField: (name: string) =>
        name === "CN" ? { value: "Empresa Test C.A." } : null,
    },
    issuer: {
      getField: (name: string) =>
        name === "CN" ? { value: "Empresa Test C.A." } : null,
    },
    setSubject: vi.fn(),
    setIssuer: vi.fn(),
    setExtensions: vi.fn(),
    sign: vi.fn(),
  };

  const fakePrivateKey = { sign: vi.fn().mockReturnValue("fakesignaturebytes") };
  const fakePublicKey = { verify: vi.fn().mockReturnValue(true) };

  const fakePkcs12 = {
    getBags: vi.fn().mockReturnValue({
      "1.2.840.113549.1.12.10.1.2": [{ cert: fakeCert }],
      "1.2.840.113549.1.12.10.1.1": [{ key: fakePrivateKey }],
      "1.2.840.113549.1.9.22.1": [{ cert: fakeCert }],
    }),
  };

  return {
    default: {
      pki: {
        oids: {
          certBag: "1.2.840.113549.1.12.10.1.2",
          pkcs8ShroudedKeyBag: "1.2.840.113549.1.12.10.1.1",
          keyBag: "1.2.840.113549.1.9.22.1",
        },
        rsa: {
          generateKeyPair: vi.fn().mockReturnValue({
            publicKey: fakePublicKey,
            privateKey: fakePrivateKey,
          }),
        },
        createCertificate: vi.fn().mockReturnValue(fakeCert),
        certificateToAsn1: vi.fn().mockReturnValue({}),
        privateKeyToPem: vi.fn().mockReturnValue("-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----"),
        publicKeyFromPem: vi.fn().mockReturnValue(fakePublicKey),
      },
      pkcs12: {
        toPkcs12Asn1: vi.fn().mockReturnValue({}),
        pkcs12FromAsn1: vi.fn().mockReturnValue(fakePkcs12),
      },
      asn1: {
        toDer: vi.fn().mockReturnValue({ getBytes: () => "fakecertbytes" }),
        fromDer: vi.fn().mockReturnValue({}),
      },
      md: {
        sha256: {
          create: vi.fn().mockReturnValue({
            update: vi.fn(),
            digest: vi.fn().mockReturnValue({ bytes: () => "fakedigestbytes" }),
          }),
        },
      },
      util: {
        createBuffer: vi.fn().mockReturnValue("fakebuffer"),
      },
    },
  };
});

import prisma from "@/lib/prisma";
import { CertificateService, decryptCertificate } from "../services/CertificateService";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY_ID = "company-test-1";
const USER_ID = "user-test-1";
const COMPANY_NAME = "Empresa Test C.A.";
const RIF = "J-12345678-9";

const FAKE_CERT_RECORD = {
  thumbprint: "a".repeat(64),
  issuedBy: COMPANY_NAME,
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  isSelfSigned: true,
};

const mockTx = {
  companyCertificate: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: { create: vi.fn() },
};

// ─── generateSelfSigned ───────────────────────────────────────────────────────

describe("CertificateService.generateSelfSigned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.companyCertificate.findUnique.mockResolvedValue(null);
    mockTx.companyCertificate.create.mockResolvedValue({
      id: "cert-1",
      ...FAKE_CERT_RECORD,
    });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it("crea CompanyCertificate con isSelfSigned: true", async () => {
    const result = await CertificateService.generateSelfSigned(
      mockTx as never,
      COMPANY_ID,
      COMPANY_NAME,
      RIF,
      USER_ID,
      "127.0.0.1",
      "Mozilla/5.0",
    );

    expect(result.isSelfSigned).toBe(true);
    expect(mockTx.companyCertificate.create).toHaveBeenCalledOnce();
    expect(mockTx.companyCertificate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: COMPANY_ID,
          isSelfSigned: true,
          createdBy: USER_ID,
        }),
      }),
    );
  });

  it("thumbprint retornado es un string de 64 chars hexadecimales", async () => {
    const result = await CertificateService.generateSelfSigned(
      mockTx as never,
      COMPANY_ID,
      COMPANY_NAME,
      RIF,
      USER_ID,
      null,
      null,
    );

    expect(result.thumbprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("expiresAt está aproximadamente 2 años en el futuro", async () => {
    const result = await CertificateService.generateSelfSigned(
      mockTx as never,
      COMPANY_ID,
      COMPANY_NAME,
      RIF,
      USER_ID,
      null,
      null,
    );

    const twoYearsFromNow = Date.now() + 2 * 365 * 24 * 60 * 60 * 1000;
    const diff = Math.abs(result.expiresAt.getTime() - twoYearsFromNow);
    expect(diff).toBeLessThan(2 * 24 * 60 * 60 * 1000); // margen de 2 días (año bisiesto)
  });

  it("crea AuditLog en el mismo $transaction", async () => {
    await CertificateService.generateSelfSigned(
      mockTx as never,
      COMPANY_ID,
      COMPANY_NAME,
      RIF,
      USER_ID,
      "192.168.1.1",
      "TestAgent",
    );

    expect(mockTx.auditLog.create).toHaveBeenCalledOnce();
    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CERTIFICATE_GENERATED",
          ipAddress: "192.168.1.1",
          userAgent: "TestAgent",
        }),
      }),
    );
  });

  it("rechaza si ya existe certificado para la empresa", async () => {
    mockTx.companyCertificate.findUnique.mockResolvedValue({ id: "existing-cert" });

    await expect(
      CertificateService.generateSelfSigned(
        mockTx as never,
        COMPANY_ID,
        COMPANY_NAME,
        RIF,
        USER_ID,
        null,
        null,
      ),
    ).rejects.toThrow("ya tiene un certificado activo");
  });

  it("encryptedP12 almacenado no es el p12 sin cifrar", async () => {
    let capturedData: Record<string, unknown> | null = null;
    mockTx.companyCertificate.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      capturedData = data;
      return { id: "cert-1", ...FAKE_CERT_RECORD };
    });

    await CertificateService.generateSelfSigned(
      mockTx as never,
      COMPANY_ID,
      COMPANY_NAME,
      RIF,
      USER_ID,
      null,
      null,
    );

    // El campo encryptedP12 debe ser Uint8Array (AES-256-GCM, compatible Prisma Bytes), no el PKCS#12 raw
    expect(capturedData).not.toBeNull();
    expect(capturedData!.encryptedP12 instanceof Uint8Array).toBe(true);
  });
});

// ─── loadOfficialCertificate ──────────────────────────────────────────────────

describe("CertificateService.loadOfficialCertificate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.companyCertificate.upsert.mockResolvedValue({ id: "cert-2", ...FAKE_CERT_RECORD });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it("rechaza Buffer que no es PKCS#12 válido", async () => {
    const forge = (await import("node-forge")).default;
    vi.mocked(forge.asn1.fromDer).mockImplementationOnce(() => {
      throw new Error("ASN.1 inválido");
    });

    await expect(
      CertificateService.loadOfficialCertificate(
        mockTx as never,
        COMPANY_ID,
        Buffer.from("notap12"),
        USER_ID,
        null,
        null,
      ),
    ).rejects.toThrow("El archivo .p12 no es válido");
  });

  it("extrae correctamente commonName e issuedBy del certificado", async () => {
    await CertificateService.loadOfficialCertificate(
      mockTx as never,
      COMPANY_ID,
      Buffer.from("fakep12content"),
      USER_ID,
      null,
      null,
    );

    expect(mockTx.companyCertificate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          commonName: "Empresa Test C.A.",
          issuedBy: "Empresa Test C.A.",
        }),
      }),
    );
  });

  it("hace upsert (reemplaza certificado anterior)", async () => {
    await CertificateService.loadOfficialCertificate(
      mockTx as never,
      COMPANY_ID,
      Buffer.from("fakep12content"),
      USER_ID,
      null,
      null,
    );

    expect(mockTx.companyCertificate.upsert).toHaveBeenCalledOnce();
  });

  it("crea AuditLog en mismo $transaction con action CERTIFICATE_LOADED", async () => {
    await CertificateService.loadOfficialCertificate(
      mockTx as never,
      COMPANY_ID,
      Buffer.from("fakep12content"),
      USER_ID,
      "10.0.0.1",
      "Chrome/99",
    );

    expect(mockTx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CERTIFICATE_LOADED" }),
      }),
    );
  });
});

// ─── decryptCertificate ───────────────────────────────────────────────────────

describe("decryptCertificate", () => {
  it("descifra correctamente lo que cifró encryptP12", async () => {
    // Necesitamos acceso a encryptP12 que es interna — la probamos indirectamente
    // a través de generateSelfSigned + decryptCertificate

    // Importar encryptP12 no es posible (no exportada), así que testeamos la simetría
    // usando el módulo de crypto directamente con el mismo algoritmo
    const crypto = await import("node:crypto");
    const companyId = "test-company-decrypt";
    const secret = process.env.CERT_ENCRYPTION_SECRET ?? "";
    const key = crypto.createHash("sha256").update(companyId + secret).digest();
    const iv = crypto.randomBytes(12);
    const plaintext = Buffer.from("test-p12-content");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([iv, authTag, encrypted]);

    const decrypted = decryptCertificate(encryptedBuffer, companyId);
    expect(decrypted.toString()).toBe("test-p12-content");
  });

  it("falla con CERT_ENCRYPTION_SECRET diferente (datos corruptos)", () => {
    const crypto = require("node:crypto");
    // Cifrar con una key
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from("secret")), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([iv, authTag, encrypted]);

    // Descifrar con otra empresa (key diferente) debe fallar
    expect(() => decryptCertificate(encryptedBuffer, "wrong-company-id")).toThrow();
  });
});

// ─── getCertificateStatus ─────────────────────────────────────────────────────

describe("CertificateService.getCertificateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna exists: false si no hay certificado", async () => {
    vi.mocked(prisma.companyCertificate.findUnique).mockResolvedValue(null as never);

    const result = await CertificateService.getCertificateStatus(COMPANY_ID);
    expect(result.exists).toBe(false);
  });

  it("nunca incluye encryptedP12 en el resultado", async () => {
    vi.mocked(prisma.companyCertificate.findUnique).mockResolvedValue({
      thumbprint: "a".repeat(64),
      issuedBy: "Test CA",
      expiresAt: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
      isSelfSigned: false,
    } as never);

    const result = await CertificateService.getCertificateStatus(COMPANY_ID);
    expect(result).not.toHaveProperty("encryptedP12");
  });

  it("daysUntilExpiry calculado correctamente", async () => {
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 días
    vi.mocked(prisma.companyCertificate.findUnique).mockResolvedValue({
      thumbprint: "a".repeat(64),
      issuedBy: "CA",
      expiresAt: future,
      isSelfSigned: true,
    } as never);

    const result = await CertificateService.getCertificateStatus(COMPANY_ID);
    expect(result.daysUntilExpiry).toBeGreaterThanOrEqual(59);
    expect(result.daysUntilExpiry).toBeLessThanOrEqual(61);
  });

  it("warningExpiringSoon: true cuando quedan ≤ 30 días", async () => {
    const soon = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000); // 20 días
    vi.mocked(prisma.companyCertificate.findUnique).mockResolvedValue({
      thumbprint: "a".repeat(64),
      issuedBy: "CA",
      expiresAt: soon,
      isSelfSigned: false,
    } as never);

    const result = await CertificateService.getCertificateStatus(COMPANY_ID);
    expect(result.warningExpiringSoon).toBe(true);
  });

  it("warningExpiringSoon: false cuando quedan > 30 días", async () => {
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 días
    vi.mocked(prisma.companyCertificate.findUnique).mockResolvedValue({
      thumbprint: "a".repeat(64),
      issuedBy: "CA",
      expiresAt: far,
      isSelfSigned: true,
    } as never);

    const result = await CertificateService.getCertificateStatus(COMPANY_ID);
    expect(result.warningExpiringSoon).toBe(false);
  });
});
