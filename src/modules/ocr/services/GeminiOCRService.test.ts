// src/modules/ocr/services/GeminiOCRService.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateContent = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent };
    }
  },
}));

import { GeminiOCRService } from "./GeminiOCRService";

beforeEach(() => vi.clearAllMocks());

describe("GeminiOCRService.extractInvoiceData", () => {
  it("extrae datos de factura correctamente", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            supplierName: "Distribuidora ABC C.A.",
            supplierRif: "J-12345678-9",
            invoiceNumber: "00001234",
            invoiceDate: "2026-03-12",
            subtotal: "100.00",
            taxAmount: "16.00",
            totalAmount: "116.00",
            currency: "VES",
            paymentMethod: "PAGO_MOVIL",
          }),
      },
    });

    const result = await GeminiOCRService.extractInvoiceData("base64string", "image/jpeg");

    expect(result.supplierName).toBe("Distribuidora ABC C.A.");
    expect(result.supplierRif).toBe("J-12345678-9");
    expect(result.totalAmount).toBe("116.00");
    expect(result.paymentMethod).toBe("PAGO_MOVIL");
  });

  it("limpia backticks de markdown en la respuesta", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```json\n{"totalAmount": "116.00"}\n```',
      },
    });

    const result = await GeminiOCRService.extractInvoiceData("base64string", "image/jpeg");
    expect(result.totalAmount).toBe("116.00");
  });

  it("lanza error si la respuesta no es JSON válido", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => "No pude procesar la imagen",
      },
    });

    await expect(
      GeminiOCRService.extractInvoiceData("base64string", "image/jpeg")
    ).rejects.toThrow();
  });

  it("acepta factura con campos opcionales omitidos", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            totalAmount: "500.00",
            currency: "USD",
          }),
      },
    });

    const result = await GeminiOCRService.extractInvoiceData("base64string", "image/png");
    expect(result.totalAmount).toBe("500.00");
    expect(result.supplierName).toBeUndefined();
  });
});
