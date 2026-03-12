// src/modules/ocr/services/GeminiOCRService.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ExtractedInvoiceSchema, type ExtractedInvoice } from "../schemas/invoice.schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const EXTRACTION_PROMPT = `
Eres un asistente contable especializado en facturas venezolanas.
Analiza la imagen de esta factura y extrae la siguiente información en formato JSON.

Devuelve ÚNICAMENTE un objeto JSON válido con estos campos (omite los que no encuentres):
{
  "supplierName": "nombre del proveedor o emisor",
  "supplierRif": "RIF del proveedor (formato J-XXXXXXXX-X o V-XXXXXXXX)",
  "invoiceNumber": "número de factura o número de control",
  "invoiceDate": "fecha en formato YYYY-MM-DD",
  "subtotal": "monto antes de impuestos como string numérico",
  "taxAmount": "monto del IVA como string numérico",
  "totalAmount": "monto total como string numérico",
  "currency": "VES, USD o EUR",
  "paymentMethod": "uno de: EFECTIVO, TARJETA, PAGO_MOVIL, ZELLE, CASHEA, TRANSFERENCIA, OTRO",
  "items": [
    {
      "description": "descripción del producto o servicio",
      "quantity": "cantidad como string",
      "unitPrice": "precio unitario como string",
      "totalPrice": "precio total de la línea como string"
    }
  ],
  "notes": "cualquier información adicional relevante"
}

IMPORTANTE:
- Devuelve SOLO el JSON, sin texto adicional, sin markdown, sin backticks
- Los montos deben ser strings numéricos sin símbolos de moneda
- Si no puedes determinar un campo con certeza, omítelo
- Para facturas venezolanas, el IVA estándar es 16%
`;

export class GeminiOCRService {
  static async extractInvoiceData(
    imageBase64: string,
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
  ): Promise<ExtractedInvoice> {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        temperature: 0,
      },
    });

    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      {
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      },
    ]);

    const text = result.response.text().trim();

    // Limpiar posibles backticks o markdown
    const clean = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(clean);
    return ExtractedInvoiceSchema.parse(parsed);
  }
}
