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
 * JSON válido alineado a ExtractedInvoiceSchema con campos VEN-NIF (OCR-v2).
 */
const VALID_INVOICE_JSON = JSON.stringify({
  razonSocial: "Distribuidora ABC C.A.",
  rif: "J-12345678-9",
  numeroFactura: "0001234",
  numeroControl: "00-0001234",
  fechaEmision: "2026-04-04",
  baseImponibleGeneral: "100.00",
  ivaGeneral: "16.00",
  montoTotal: "116.00",
  currency: "VES",
  paymentMethod: "TRANSFERENCIA",
});

// ─── extractFromImage ────────────────────────────────────────────────────────

describe("GeminiOCRService.extractFromImage", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-api-key-fake");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("extrae datos de factura correctamente desde imagen (campos VEN-NIF)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockGeminiResponse(VALID_INVOICE_JSON));

    const result = await GeminiOCRService.extractFromImage("base64fake==");

    expect(result.rif).toBe("J-12345678-9");
    expect(result.razonSocial).toBe("Distribuidora ABC C.A.");
    expect(result.montoTotal).toBe("116.00");
    expect(result.ivaGeneral).toBe("16.00");
    expect(result.baseImponibleGeneral).toBe("100.00");
    expect(result.numeroControl).toBe("00-0001234");
    expect(result.currency).toBe("VES");
  });

  it("limpia bloques markdown que Gemini incluye a veces", async () => {
    const withMarkdown = "```json\n" + VALID_INVOICE_JSON + "\n```";
    vi.spyOn(global, "fetch").mockResolvedValueOnce(mockGeminiResponse(withMarkdown));

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.numeroFactura).toBe("0001234");
  });

  it("lanza error si GEMINI_API_KEY no está configurada", async () => {
    vi.unstubAllEnvs();
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
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockGeminiResponse(
        JSON.stringify({
          montoTotal: "100.00",
          currency: "BOLIVARES_FUERTES",
        })
      )
    );

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.currency).toBeUndefined();
    expect(result.montoTotal).toBe("100.00");
  });

  it("normaliza montos en formato VE si Gemini ignora la instrucción de formato", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockGeminiResponse(
        JSON.stringify({
          razonSocial: "Empresa Test",
          rif: "J-11111111-1",
          baseImponibleGeneral: "1.000,00",  // VE: coma decimal
          ivaGeneral: "160,00",              // VE: coma decimal
          montoTotal: "1.160,00",            // VE: miles + coma
          currency: "VES",
          items: [
            {
              description: "Producto A",
              quantity: "2",
              unitPrice: "500,00",
              totalPrice: "1.000,00",
            },
          ],
        })
      )
    );

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.baseImponibleGeneral).toBe("1000");
    expect(result.ivaGeneral).toBe("160");
    expect(result.montoTotal).toBe("1160");
    expect(result.items?.[0].unitPrice).toBe("500");
    expect(result.items?.[0].totalPrice).toBe("1000");
  });

  it("extrae campos de IVA reducido y adicional cuando están presentes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      mockGeminiResponse(
        JSON.stringify({
          razonSocial: "Farmacia XYZ",
          rif: "J-87654321-0",
          baseImponibleGeneral: "200.00",
          ivaGeneral: "32.00",
          baseImponibleReducida: "50.00",
          ivaReducido: "4.00",
          montoTotal: "286.00",
          currency: "VES",
        })
      )
    );

    const result = await GeminiOCRService.extractFromImage("base64fake==");
    expect(result.baseImponibleReducida).toBe("50.00");
    expect(result.ivaReducido).toBe("4.00");
  });
});
