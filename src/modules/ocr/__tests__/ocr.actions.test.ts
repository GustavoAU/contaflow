// src/modules/ocr/__tests__/ocr.actions.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks hoisted (vi.mock se eleva al tope) ────────────────────────────────

const { mockAuth, mockCheckRateLimit, mockFindFirst, mockExtractFromImage } = vi.hoisted(() => ({
  mockAuth: vi.fn().mockResolvedValue({ userId: "user_test" }),
  mockCheckRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  mockFindFirst: vi.fn(),
  mockExtractFromImage: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth }));

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: mockCheckRateLimit,
  limiters: { ocr: {} },
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    companyMember: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

vi.mock("../services/GeminiOCRService", () => ({
  GeminiOCRService: {
    extractFromImage: (...args: unknown[]) => mockExtractFromImage(...args),
  },
}));

import { extractInvoiceAction } from "../actions/ocr.actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_OCR_DATA = {
  razonSocial: "Empresa Test C.A.",
  rif: "J-12345678-9",
  numeroFactura: "0001234",
  numeroControl: "00-0001234",
  fechaEmision: "2026-04-07",
  baseImponibleGeneral: "100.00",
  ivaGeneral: "16.00",
  montoTotal: "116.00",
  currency: "VES" as const,
  paymentMethod: "TRANSFERENCIA" as const,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("extractInvoiceAction — OCR-v2 (Gemini Vision)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: "user_test" });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockFindFirst.mockResolvedValue({ role: "ACCOUNTANT" });
    mockExtractFromImage.mockResolvedValue(VALID_OCR_DATA);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retorna error si no hay sesión autenticada", async () => {
    mockAuth.mockResolvedValueOnce({ userId: null });

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("No autorizado");
  });

  it("retorna error si rate limit excedido", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      error: "Demasiadas solicitudes",
    });

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Demasiadas solicitudes");
  });

  it("retorna error si companyId está vacío (validación Zod)", async () => {
    const result = await extractInvoiceAction("", "base64data==");
    expect(result.success).toBe(false);
  });

  it("retorna error si base64 está vacío (validación Zod)", async () => {
    const result = await extractInvoiceAction("company-1", "");
    expect(result.success).toBe(false);
  });

  it("retorna error si el usuario no es miembro de la empresa", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("acceso denegado");
  });

  it("retorna error si GEMINI_API_KEY no está configurada", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GEMINI_API_KEY", "");

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("GEMINI_API_KEY");
  });

  it("extrae datos correctamente con VIEWER (cualquier rol puede usar OCR)", async () => {
    mockFindFirst.mockResolvedValueOnce({ role: "VIEWER" });

    const result = await extractInvoiceAction("company-1", "base64data==", "image/jpeg");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rif).toBe("J-12345678-9");
      expect(result.data.razonSocial).toBe("Empresa Test C.A.");
      expect(result.data.montoTotal).toBe("116.00");
    }
  });

  it("extrae datos correctamente con ACCOUNTANT", async () => {
    const result = await extractInvoiceAction("company-1", "base64data==", "image/png");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.numeroFactura).toBe("0001234");
      expect(result.data.currency).toBe("VES");
    }
  });

  it("propaga el mimeType correcto a GeminiOCRService", async () => {
    await extractInvoiceAction("company-1", "base64data==", "image/webp");
    expect(mockExtractFromImage).toHaveBeenCalledWith("base64data==", "image/webp");
  });

  it("mimeType inválido hace fallback a image/jpeg (catch en schema Zod)", async () => {
    await extractInvoiceAction("company-1", "base64data==", "application/pdf");
    expect(mockExtractFromImage).toHaveBeenCalledWith("base64data==", "image/jpeg");
  });

  it("retorna error si GeminiOCRService lanza una excepción", async () => {
    mockExtractFromImage.mockRejectedValueOnce(
      new Error("Gemini API error 429: Too Many Requests")
    );

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Gemini API error 429");
  });

  it("retorna error genérico si se lanza un no-Error", async () => {
    mockExtractFromImage.mockRejectedValueOnce("string error");

    const result = await extractInvoiceAction("company-1", "base64data==");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Error al procesar");
  });

  it("verifica que auth se llame ANTES del rate limit (ADR-006 D-1)", async () => {
    const callOrder: string[] = [];
    mockAuth.mockImplementationOnce(async () => {
      callOrder.push("auth");
      return { userId: "user_test" };
    });
    mockCheckRateLimit.mockImplementationOnce(async () => {
      callOrder.push("rateLimit");
      return { allowed: true };
    });

    await extractInvoiceAction("company-1", "base64data==");
    expect(callOrder[0]).toBe("auth");
    expect(callOrder[1]).toBe("rateLimit");
  });
});
