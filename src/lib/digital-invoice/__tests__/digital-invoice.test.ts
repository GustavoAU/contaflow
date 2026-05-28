import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Decimal from "decimal.js";
import { createCipheriv, randomBytes } from "crypto";
import { MockDigitalInvoiceProvider } from "../providers/mock.provider";
import { NullDigitalInvoiceProvider } from "../providers/null.provider";
import { HKADigitalInvoiceProvider } from "../providers/hka/hka.provider";
import { createDigitalInvoiceProvider, createMockProvider, createNullProvider } from "../DigitalInvoiceFactory";
import { DigitalInvoiceProviderError, DigitalInvoiceTimeoutError } from "../provider.types";
import type { DigitalInvoiceSubmission } from "../provider.types";

const BASE_INVOICE: DigitalInvoiceSubmission = {
  companyRif:     "J-12345678-9",
  companyName:    "Empresa Demo C.A.",
  companyAddress: "Av. Principal, Caracas",
  customerRif:    "V-12345678",
  customerName:   "Cliente Demo",
  invoiceDate:    new Date("2026-05-27"),
  docType:        "FACTURA",
  lines: [
    {
      description: "Servicio de consultoría",
      quantity:    new Decimal("1"),
      unitPrice:   new Decimal("100.00"),
      taxRate:     16,
      total:       new Decimal("100.00"),
    },
  ],
  subtotal:  new Decimal("100.00"),
  ivaAmount: new Decimal("16.00"),
  total:     new Decimal("116.00"),
  currency:  "VES",
};

// Helper: AES-256-GCM encrypt — mirrors decryptApiKey in DigitalInvoiceFactory
function encryptApiKey(secret: string, plaintext: string): string {
  const key = Buffer.from(secret.slice(0, 64).padEnd(64, "0"), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ─── MockDigitalInvoiceProvider ───────────────────────────────────────────────

describe("MockDigitalInvoiceProvider", () => {
  it("devuelve número de control y QR al emitir factura", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const result = await provider.submitInvoice(BASE_INVOICE);

    expect(result.controlNumber).toMatch(/^00-\d{8}$/);
    expect(result.qrCodeData).toContain("efactura.seniat.gob.ve");
    expect(result.providerReferenceId).toContain("MOCK-");
    expect(result.isContingency).toBe(false);
  });

  it("genera números de control incrementales", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const r1 = await provider.submitInvoice(BASE_INVOICE);
    const r2 = await provider.submitInvoice(BASE_INVOICE);

    const n1 = parseInt(r1.controlNumber.split("-")[1]);
    const n2 = parseInt(r2.controlNumber.split("-")[1]);
    expect(n2).toBe(n1 + 1);
  });

  it("simula contingencia cuando simulateContingency=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateContingency: true });
    const result = await provider.submitInvoice(BASE_INVOICE);
    expect(result.isContingency).toBe(true);
  });

  it("lanza DigitalInvoiceProviderError cuando simulateTimeout=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateTimeout: true });
    await expect(provider.submitInvoice(BASE_INVOICE)).rejects.toBeInstanceOf(
      DigitalInvoiceProviderError,
    );
  });

  it("healthCheck devuelve true en condiciones normales", async () => {
    const provider = new MockDigitalInvoiceProvider();
    expect(await provider.healthCheck()).toBe(true);
  });

  it("healthCheck devuelve false cuando simulateTimeout=true", async () => {
    const provider = new MockDigitalInvoiceProvider({ simulateTimeout: true });
    expect(await provider.healthCheck()).toBe(false);
  });

  it("voidInvoice devuelve success:true", async () => {
    const provider = new MockDigitalInvoiceProvider();
    const result = await provider.voidInvoice("00-00001001", "Error de prueba");
    expect(result.success).toBe(true);
    expect(result.voidedAt).toBeInstanceOf(Date);
  });
});

// ─── NullDigitalInvoiceProvider ───────────────────────────────────────────────

describe("NullDigitalInvoiceProvider", () => {
  it("lanza error si se intenta emitir", async () => {
    const provider = new NullDigitalInvoiceProvider();
    await expect(provider.submitInvoice(BASE_INVOICE)).rejects.toThrow("NullProvider");
  });

  it("lanza error si se intenta anular", async () => {
    const provider = new NullDigitalInvoiceProvider();
    await expect(provider.voidInvoice("00-00000001", "motivo")).rejects.toThrow("NullProvider");
  });

  it("healthCheck devuelve false", async () => {
    const provider = new NullDigitalInvoiceProvider();
    expect(await provider.healthCheck()).toBe(false);
  });
});

// ─── HKADigitalInvoiceProvider ────────────────────────────────────────────────

describe("HKADigitalInvoiceProvider", () => {
  let provider: HKADigitalInvoiceProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    provider = new HKADigitalInvoiceProvider({
      apiKey:  "test-api-key",
      baseUrl: "https://api.test.com/v1",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // submitInvoice — happy path
  it("submitInvoice retorna resultado correcto cuando HKA responde ok", async () => {
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({
        codigo_respuesta: "00",
        numero_control:   "00-12345678",
        qr_url:           "https://qr.test.com/xxx",
        id_transaccion:   "TXN-001",
        fecha_emision:    "2026-05-27T10:00:00Z",
        contingencia:     false,
      }),
    });

    const result = await provider.submitInvoice(BASE_INVOICE);

    expect(result.controlNumber).toBe("00-12345678");
    expect(result.qrCodeData).toBe("https://qr.test.com/xxx");
    expect(result.providerReferenceId).toBe("TXN-001");
    expect(result.isContingency).toBe(false);
  });

  it("submitInvoice incluye exchangeRate y relatedControlNumber cuando se proveen", async () => {
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({
        codigo_respuesta: "00",
        numero_control:   "00-00000002",
        qr_url:           "https://qr.test.com/yyy",
        id_transaccion:   "TXN-002",
        fecha_emision:    "2026-05-27T10:00:00Z",
        contingencia:     false,
      }),
    });

    const invoiceWithExtras: DigitalInvoiceSubmission = {
      ...BASE_INVOICE,
      currency:              "USD",
      exchangeRate:          new Decimal("36.50"),
      relatedControlNumber:  "00-00000001",
      docType:               "NOTA_CREDITO",
    };

    const result = await provider.submitInvoice(invoiceWithExtras);
    expect(result.controlNumber).toBe("00-00000002");

    const [, options] = mockFetch.mock.calls[0];
    const parsed = JSON.parse((options as { body: string }).body);
    expect(parsed.tasa_cambio).toBe("36.5000");
    expect(parsed.numero_control_relacionado).toBe("00-00000001");
    expect(parsed.tipo_documento).toBe("03"); // NOTA_CREDITO → "03"
  });

  it("submitInvoice mapea NOTA_DEBITO a tipo_documento '02'", async () => {
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({
        codigo_respuesta: "00",
        numero_control:   "00-00000003",
        qr_url:           "https://qr.test.com",
        id_transaccion:   "TXN-003",
        fecha_emision:    "2026-05-27T10:00:00Z",
        contingencia:     false,
      }),
    });

    await provider.submitInvoice({ ...BASE_INVOICE, docType: "NOTA_DEBITO" });

    const [, options] = mockFetch.mock.calls[0];
    const parsed = JSON.parse((options as { body: string }).body);
    expect(parsed.tipo_documento).toBe("02");
  });

  // submitInvoice — error paths
  it("submitInvoice lanza DigitalInvoiceTimeoutError cuando fetch hace AbortError", async () => {
    const abortErr = Object.assign(new Error("abort"), { name: "AbortError" });
    mockFetch.mockRejectedValue(abortErr);

    await expect(provider.submitInvoice(BASE_INVOICE)).rejects.toBeInstanceOf(
      DigitalInvoiceTimeoutError,
    );
  });

  it("submitInvoice lanza DigitalInvoiceProviderError en error de red genérico", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const err = await provider.submitInvoice(BASE_INVOICE).catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("ECONNREFUSED");
  });

  it("submitInvoice lanza DigitalInvoiceProviderError retryable en 5xx", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const err = await provider.submitInvoice(BASE_INVOICE).catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.retryable).toBe(true);
  });

  it("submitInvoice lanza DigitalInvoiceProviderError non-retryable en 4xx", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400 });

    const err = await provider.submitInvoice(BASE_INVOICE).catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.retryable).toBe(false);
  });

  it("submitInvoice lanza DigitalInvoiceProviderError cuando codigo_respuesta != '00'", async () => {
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({ codigo_respuesta: "01", mensaje: "RIF inválido" }),
    });

    const err = await provider.submitInvoice(BASE_INVOICE).catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.message).toContain("RIF inválido");
    expect(err.retryable).toBe(false);
  });

  // voidInvoice
  it("voidInvoice retorna success:true cuando HKA responde ok", async () => {
    mockFetch.mockResolvedValue({
      ok:   true,
      json: async () => ({
        codigo_respuesta: "00",
        fecha_anulacion:  "2026-05-27T12:00:00Z",
      }),
    });

    const result = await provider.voidInvoice("00-12345678", "Factura duplicada");
    expect(result.success).toBe(true);
    expect(result.voidedAt).toBeInstanceOf(Date);
  });

  it("voidInvoice lanza DigitalInvoiceProviderError en error de red", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    const err = await provider.voidInvoice("00-12345678", "motivo").catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.retryable).toBe(true);
  });

  it("voidInvoice lanza DigitalInvoiceProviderError cuando respuesta no es ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const err = await provider.voidInvoice("00-12345678", "motivo").catch((e) => e);
    expect(err).toBeInstanceOf(DigitalInvoiceProviderError);
    expect(err.retryable).toBe(false);
  });

  // healthCheck
  it("healthCheck devuelve true cuando endpoint responde ok", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    expect(await provider.healthCheck()).toBe(true);
  });

  it("healthCheck devuelve false cuando endpoint falla", async () => {
    mockFetch.mockRejectedValue(new Error("timeout"));
    expect(await provider.healthCheck()).toBe(false);
  });
});

// ─── createDigitalInvoiceProvider (factory) ───────────────────────────────────

describe("createDigitalInvoiceProvider (factory)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en NODE_ENV=test siempre retorna MockProvider", () => {
    const provider = createDigitalInvoiceProvider({ provider: "NONE" });
    expect(provider?.name).toBe("MOCK");
  });

  it("createMockProvider crea un MockProvider directamente", () => {
    const provider = createMockProvider({ simulateContingency: true });
    expect(provider.name).toBe("MOCK");
  });

  it("createNullProvider crea un NullProvider directamente", () => {
    const provider = createNullProvider();
    expect(provider.name).toBe("NULL");
  });
});

describe("createDigitalInvoiceProvider (factory) — producción", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("en producción con NONE retorna null", () => {
    vi.stubEnv("NODE_ENV", "production");
    const provider = createDigitalInvoiceProvider({ provider: "NONE" });
    expect(provider).toBeNull();
  });

  it("en producción con HKA sin apiKeyEnc lanza error", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createDigitalInvoiceProvider({ provider: "HKA", apiKeyEnc: null }),
    ).toThrow("HKA configurado pero sin API key");
  });

  it("en producción con HKA y CERT_ENCRYPTION_SECRET ausente lanza error al descifrar", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CERT_ENCRYPTION_SECRET", "");
    expect(() =>
      createDigitalInvoiceProvider({ provider: "HKA", apiKeyEnc: "aabb:ccdd:eeff" }),
    ).toThrow("CERT_ENCRYPTION_SECRET no configurado");
  });

  it("en producción con HKA y formato cifrado inválido lanza error", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CERT_ENCRYPTION_SECRET", "a".repeat(64));
    expect(() =>
      createDigitalInvoiceProvider({ provider: "HKA", apiKeyEnc: "formato-invalido" }),
    ).toThrow("Formato de clave cifrada inválido");
  });

  it("en producción con HKA y clave cifrada válida retorna HKAProvider", () => {
    vi.stubEnv("NODE_ENV", "production");
    const secret = "ab".repeat(32); // 64 chars hex
    vi.stubEnv("CERT_ENCRYPTION_SECRET", secret);
    vi.stubEnv("HKA_API_URL", "https://api.hka.test/v1");

    const apiKeyEnc = encryptApiKey(secret, "my-real-api-key");
    const provider = createDigitalInvoiceProvider({ provider: "HKA", apiKeyEnc });

    expect(provider?.name).toBe("HKA");
  });
});
