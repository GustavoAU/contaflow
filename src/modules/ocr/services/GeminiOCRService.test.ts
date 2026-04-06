// src/modules/ocr/services/GeminiOCRService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiOCRService } from "./GeminiOCRService";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Construye una respuesta fake de la API de Gemini con el texto dado */
function mockGeminiResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * JSON válido alineado a ExtractedInvoiceSchema (invoice.schema.ts).
 * TODO (Fase OCR-v2): migrar schema a campos VEN-NIF:
 *   supplierRif → rif, invoiceNumber → numeroFactura, + numeroControl,
 *   + baseImponible/iva por alícuota, montos como Decimal en lugar de string.
 */
const VALID_INVOICE_JSON = JSON.stringify({
  supplierName: "Distribuidora ABC C.A.",
  supplierRif: "J-12345678-9",
  invoiceNumber: "0001234",
  invoiceDate: "2026-04-04",
  subtotal: "100.00",
  taxAmount: "16.00",
  totalAmount: "116.00",
  currency: "VES",
  paymentMethod: "TRANSFERENCIA",
});

// ─── extractFromImage ────────────────────────────────────────────────────────

describe("GeminiOCRService.extractFromImage", () => {
  beforeEach(() => {
    // API key disponible en todos los tests de este bloque
    vi.stubEnv("GEMINI_API_KEY", "test-api-key-fake");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("extrae datos de factura correctamente desde imagen", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockGeminiResponse(VALID_INVOICE_JSON));

    const result = await GeminiOCRService.extractFromImage("base64fake==");

    expect(result.supplierRif).toBe("J-12345678-9");
    expect(result.supplierName).toBe("Distribuidora ABC C.A.");
    expect(result.totalAmount).toBe("116.00");
    expect(result.taxAmount).toBe("16.00");
    expect(result.currency).toBe("VES");
  });

  it("limpia bloques markdown que Gemini incluye a veces", async () => {
    const withMarkdown = "```json\n" + VALID_INVOICE_JSON + "\n```";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockGeminiResponse(withMarkdown));

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.invoiceNumber).toBe("0001234");
  });

  it("lanza error si GEMINI_API_KEY no está configurada", async () => {
    vi.unstubAllEnvs(); // elimina la key del beforeEach
    vi.stubEnv("GEMINI_API_KEY", "");

    await expect(GeminiOCRService.extractFromImage("base64fake==")).rejects.toThrow(
      "GEMINI_API_KEY no está configurada"
    );
  });

  it("lanza error si la API retorna status no-ok (429 rate limit)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("Too Many Requests", { status: 429 })
    );

    await expect(GeminiOCRService.extractFromImage("base64fake==")).rejects.toThrow(
      "Gemini API error 429"
    );
  });

  it("lanza error si la API retorna error en el body con status 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "API key not valid",
            status: "INVALID_ARGUMENT",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(GeminiOCRService.extractFromImage("base64fake==")).rejects.toThrow(
      "INVALID_ARGUMENT"
    );
  });

  it("lanza error si Gemini retorna JSON inválido", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockGeminiResponse("esto no es json {{{"));

    await expect(GeminiOCRService.extractFromImage("base64fake==")).rejects.toThrow(
      "JSON inválido"
    );
  });

  it("lanza error si Gemini no retorna candidates", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(GeminiOCRService.extractFromImage("base64fake==")).rejects.toThrow(
      "Gemini no retornó contenido"
    );
  });

  it("acepta imagen PNG además de JPEG", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockGeminiResponse(VALID_INVOICE_JSON));

    await GeminiOCRService.extractFromImage("base64fake==", "image/png");

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe("image/png");
  });

  it("envía temperature 0 para máximo determinismo", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(mockGeminiResponse(VALID_INVOICE_JSON));

    await GeminiOCRService.extractFromImage("base64fake==");

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.generationConfig.temperature).toBe(0);
  });

  it("devuelve currency undefined si Gemini retorna valor de currency inválido", async () => {
    // El schema usa .catch(undefined) en currency — no lanza, retorna undefined
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockGeminiResponse(
        JSON.stringify({
          totalAmount: "100.00",
          currency: "BOLIVARES_FUERTES", // valor inválido para el enum
        })
      )
    );

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.currency).toBeUndefined();
    expect(result.totalAmount).toBe("100.00");
  });
});
