// src/modules/ocr/services/GeminiOCRService.ts
//
// Plan Free  → Tesseract.js (cliente) + Groq  — datos no salen del stack
// Plan Pro   → este servicio, imagen directa a Gemini Vision, sin Tesseract
//
// DESARROLLO: tier gratuito de Gemini (Google puede usar los datos para entrenamiento)
// PRODUCCIÓN: tier pago → datos privados, no se usan para entrenamiento
//
// Rate limit gratuito: 15 RPM / 1 000 RPD  (src/lib/ratelimit.ts → ocr: 12/min con margen)

import { ExtractedInvoiceSchema, type ExtractedInvoice, type FieldRisk } from "../schemas/invoice.schema";
import { parseLocalNumber } from "@/lib/format";
import { validateVenezuelanRif } from "@/lib/fiscal-validators";

// Normaliza un string de monto en formato regional (VE o americano) a formato estándar.
// Solo actúa si detecta coma o múltiples puntos; preserva strings ya en formato estándar.
function normalizeMoneyStr(v: unknown): unknown {
  if (typeof v !== "string" || !v.trim()) return v;
  const s = v.trim();
  const hasComma = s.includes(",");
  const hasMultipleDots = (s.match(/\./g) ?? []).length > 1;
  if (!hasComma && !hasMultipleDots) return v;
  const num = parseLocalNumber(s);
  if (!isFinite(num) || isNaN(num)) return v;
  return String(num);
}

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";

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
   * Nuevo flujo: imagen → Gemini Vision (servidor) → JSON con campos VEN-NIF
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
  "razonSocial": "Nombre legal de la empresa emisora",
  "rif": "J-12345678-9",
  "numeroFactura": "0001234",
  "numeroControl": "00-0001234",
  "fechaEmision": "YYYY-MM-DD",
  "baseImponibleGeneral": "0.00",
  "ivaGeneral": "0.00",
  "baseImponibleReducida": "0.00",
  "ivaReducido": "0.00",
  "baseImponibleAdicional": "0.00",
  "ivaAdicional": "0.00",
  "montoTotal": "0.00",
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
- rif: Siempre con letra al inicio (J, V, G, E, C, P) seguida de guión y números. Ej: J-40137367-4
- currency: uno de VES | USD | EUR
- paymentMethod: uno de EFECTIVO | TARJETA | PAGO_MOVIL | ZELLE | CASHEA | TRANSFERENCIA | OTRO
- Todos los montos como strings con dos decimales en formato estándar (punto decimal): "100.00"
- FORMATO VENEZOLANO: En Venezuela se usa punto como separador de miles y coma como decimal. Ejemplo: 1.234.567,89 equivale a 1234567.89. Convierte SIEMPRE al formato numérico estándar
- fechaEmision en formato ISO 8601 (YYYY-MM-DD). Ejemplo: 22/04/2019 → 2019-04-22
- baseImponibleGeneral: base gravada con IVA 16% (alícuota general)
- baseImponibleReducida: base gravada con IVA 8% (alícuota reducida), null si no aplica
- baseImponibleAdicional: base gravada con IVA adicional 15% (productos de lujo), null si no aplica
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

    const response = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
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

    // Normalizar montos si Gemini ignoró la instrucción de formato estándar
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      for (const field of [
        "baseImponibleGeneral", "ivaGeneral",
        "baseImponibleReducida", "ivaReducido",
        "baseImponibleAdicional", "ivaAdicional",
        "montoTotal",
      ]) {
        if (obj[field] != null) obj[field] = normalizeMoneyStr(obj[field]);
      }
      if (Array.isArray(obj.items)) {
        obj.items = (obj.items as Record<string, unknown>[]).map((item) => ({
          ...item,
          quantity:   normalizeMoneyStr(item.quantity),
          unitPrice:  normalizeMoneyStr(item.unitPrice),
          totalPrice: normalizeMoneyStr(item.totalPrice),
        }));
      }
    }

    // Validar y tipar con el schema Zod existente
    const result = ExtractedInvoiceSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Los datos extraídos no pasan la validación: ${result.error.message}`
      );
    }

    // ── Validación post-extracción de campos fiscales críticos (ALERTA 13/14) ─
    // PA-00071 Art. 15: RIF incorrecto invalida el crédito fiscal.
    // El N° Control es cruzado por el SENIAT entre emisor y receptor.
    const extracted = result.data;
    const risks: FieldRisk[] = [];

    if (extracted.rif !== undefined && !validateVenezuelanRif(extracted.rif)) {
      risks.push({
        field: "rif",
        label: "RIF",
        issue: `RIF extraído "${extracted.rif}" no cumple el formato X-XXXXXXXX-X (PA-00071 Art. 15). Verifica contra la factura física.`,
        severity: "critical",
      });
    }

    if (extracted.numeroControl !== undefined && !/^\d{2}-\d{8}$/.test(extracted.numeroControl)) {
      risks.push({
        field: "numeroControl",
        label: "N° Control",
        issue: `N° Control extraído "${extracted.numeroControl}" no cumple el formato XX-XXXXXXXX. El SENIAT cruza este campo entre emisor y receptor.`,
        severity: "critical",
      });
    }

    return risks.length > 0 ? { ...extracted, _fieldRisks: risks } : extracted;
  }

}
