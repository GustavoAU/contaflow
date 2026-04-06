// src/modules/ocr/services/GeminiOCRService.ts
//
// Plan Free  → Tesseract.js (cliente) + Groq  — datos no salen del stack
// Plan Pro   → este servicio, imagen directa a Gemini Vision, sin Tesseract
//
// DESARROLLO: tier gratuito de Gemini (Google puede usar los datos para entrenamiento)
// PRODUCCIÓN: tier pago → datos privados, no se usan para entrenamiento
//
// Rate limit gratuito: 15 RPM / 1 000 RPD  (src/lib/ratelimit.ts → ocr: 12/min con margen)

import { ExtractedInvoiceSchema, type ExtractedInvoice } from "../schemas/invoice.schema";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview:generateContent";

// Tipos mínimos para la respuesta de la API de Gemini
interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { code: number; message: string; status: string };
}

export class GeminiOCRService {
  /**
   * Extrae datos de una factura venezolana a partir de una imagen en base64.
   * Reemplaza el flujo anterior: imagen → Tesseract (cliente) → texto → Groq → JSON
   * Nuevo flujo:             imagen → Gemini Vision (servidor) → JSON directo
   *
   * @param base64Image  Imagen en base64 sin el prefijo "data:image/...;base64,"
   * @param mimeType     Tipo MIME de la imagen (default: "image/jpeg")
   */
  static async extractFromImage(
    base64Image: string,
    mimeType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg"
  ): Promise<ExtractedInvoice> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno.");
    }

    const prompt = `Eres un asistente contable especializado en facturas venezolanas (VEN-NIF).
Analiza la imagen de esta factura y extrae los datos.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin bloques markdown, sin explicaciones.

Esquema exacto a retornar:
{
  "supplierName": "Nombre legal de la empresa emisora",
  "supplierRif": "J-12345678-9",
  "invoiceNumber": "0001234",
  "invoiceDate": "YYYY-MM-DD",
  "subtotal": "0.00",
  "taxAmount": "0.00",
  "totalAmount": "0.00",
  "currency": "VES",
  "paymentMethod": "TRANSFERENCIA",
  "items": [
    {
      "description": "Descripción del producto o servicio",
      "quantity": "1",
      "unitPrice": "0.00",
      "totalPrice": "0.00"
    }
  ],
  "notes": null
}

Reglas:
- currency: uno de VES | USD | EUR
- paymentMethod: uno de EFECTIVO | TARJETA | PAGO_MOVIL | ZELLE | CASHEA | TRANSFERENCIA | OTRO
- Todos los montos como strings con dos decimales: "100.00"
- invoiceDate en formato ISO 8601 (YYYY-MM-DD)
- Si un campo no aparece en la factura usar null
- items: lista vacía [] si no hay detalle de líneas
- No incluir símbolos de moneda en los valores numéricos`;

    const body = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,        // máxima determinismo para extracción de datos
        maxOutputTokens: 1024,
      },
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API error ${response.status}: ${errorText}`
      );
    }

    const data = (await response.json()) as GeminiResponse;

    // Gemini puede retornar un error en el body con status 200
    if (data.error) {
      throw new Error(
        `Gemini API error ${data.error.code} (${data.error.status}): ${data.error.message}`
      );
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error("Gemini no retornó contenido en la respuesta.");
    }

    // Limpiar posibles bloques markdown que Gemini a veces incluye
    // aunque el prompt lo pide explícitamente sin ellos
    const cleaned = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Gemini retornó JSON inválido. Respuesta cruda: ${cleaned.slice(0, 200)}`
      );
    }

    // Validar y tipar con el schema Zod existente
    const result = ExtractedInvoiceSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Los datos extraídos no pasan la validación: ${result.error.message}`
      );
    }

    return result.data;
  }

}
