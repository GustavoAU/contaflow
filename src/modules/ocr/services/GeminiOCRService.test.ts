// src/modules/ocr/services/GeminiOCRService.test.ts
import { describe, it, expect } from "vitest";
import { GeminiOCRService } from "./GeminiOCRService";

describe("GeminiOCRService.extractFromText", () => {
  it("extrae datos de factura correctamente", async () => {
    const json = JSON.stringify({
      supplierName: "Distribuidora ABC C.A.",
      supplierRif: "J-12345678-9",
      totalAmount: "116.00",
      taxAmount: "16.00",
      subtotal: "100.00",
      currency: "VES",
      paymentMethod: "PAGO_MOVIL",
    });

    const result = await GeminiOCRService.extractFromText(json);
    expect(result.supplierName).toBe("Distribuidora ABC C.A.");
    expect(result.totalAmount).toBe("116.00");
    expect(result.paymentMethod).toBe("PAGO_MOVIL");
  });

  it("lanza error si el JSON es inv├ílido", async () => {
    await expect(GeminiOCRService.extractFromText("texto no v├ílido")).rejects.toThrow();
  });

  it("acepta factura con campos opcionales omitidos", async () => {
    const json = JSON.stringify({
      totalAmount: "500.00",
      currency: "USD",
    });

    const result = await GeminiOCRService.extractFromText(json);
    expect(result.totalAmount).toBe("500.00");
    expect(result.supplierName).toBeUndefined();
  });

  it("devuelve currency undefined si el valor es inv├ílido", async () => {
    const json = JSON.stringify({
      currency: "INVALIDA",
      totalAmount: "100.00",
    });

    const result = await GeminiOCRService.extractFromText(json);
    expect(result.currency).toBeUndefined();
    expect(result.totalAmount).toBe("100.00");
  });
});