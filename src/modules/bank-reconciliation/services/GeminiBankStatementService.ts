// src/modules/bank-reconciliation/services/GeminiBankStatementService.ts
//
// Extrae filas de un extracto bancario venezolano (PDF) usando Gemini Vision.
// Reutiliza el mismo patrón de GeminiOCRService pero con prompt específico
// para estados de cuenta (BNC, Banesco, Mercantil, Provincial, BDV).
//
// Rate limit: limiters.ocr (10/min) — aplicado en la action, no aquí.

import {
  ExtractedBankStatementSchema,
  type ExtractedBankStatement,
} from "../schemas/auto-reconciliation.schema";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview:generateContent";

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { code: number; message: string; status: string };
}

export class GeminiBankStatementService {
  /**
   * Extrae las filas de un estado de cuenta bancario venezolano desde un PDF en base64.
   *
   * @param base64Pdf  PDF en base64 sin el prefijo "data:application/pdf;base64,"
   */
  static async extractFromPdf(base64Pdf: string): Promise<ExtractedBankStatement> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno.");
    }

    const prompt = `Eres un asistente contable especializado en estados de cuenta bancarios venezolanos.
Analiza este estado de cuenta y extrae todos los movimientos y metadatos.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin bloques markdown, sin explicaciones.

Bancos soportados: BNC (Banco Nacional de Crédito), Banesco, Mercantil, Provincial, BDV, Venezolano de Crédito.

IMPORTANTE — Formato venezolano:
- Separador de miles: punto (.) — ej: 1.000.000
- Separador decimal: coma (,) — ej: 1.234,56
- MANTÉN los montos en formato venezolano tal como aparecen en el documento (ej: "1.000,50").
  El sistema los convertirá. NO hagas la conversión tú.
- Los montos de Debe/Débito son salidas (negativos en el extracto pero devuélvelos SIN signo negativo).
- Los montos de Haber/Crédito son entradas.

Esquema exacto a retornar:
{
  "rows": [
    {
      "date": "dd/mm/yyyy",
      "description": "Descripción del movimiento",
      "reference": "número de referencia o null",
      "debit": "monto en formato venezolano o null si no hay débito",
      "credit": "monto en formato venezolano o null si no hay crédito",
      "balance": "saldo en formato venezolano o null"
    }
  ],
  "openingBalance": "saldo inicial en formato venezolano o null",
  "closingBalance": "saldo final en formato venezolano o null",
  "accountNumber": "número de cuenta (puede estar enmascarado: ***9550) o null",
  "bankName": "nombre del banco o null",
  "periodStart": "dd/mm/yyyy de la primera transacción o null",
  "periodEnd": "dd/mm/yyyy de la última transacción o null",
  "holderName": "nombre del titular o null"
}

Reglas:
- rows: lista de TODOS los movimientos en orden cronológico (más antiguo primero)
- Si el extracto muestra movimientos del más reciente al más antiguo, invierte el orden
- date: siempre formato dd/mm/yyyy
- reference: extrae el número de referencia si aparece en la descripción o en columna separada, sino null
- debit: monto de débito/cargo/debe SIN signo negativo, o null si la fila no tiene débito
- credit: monto de crédito/abono/haber, o null si la fila no tiene crédito
- Una fila nunca tiene debit y credit al mismo tiempo
- openingBalance: saldo ANTES de la primera transacción (calcúlalo si no aparece explícito)
- closingBalance: saldo DESPUÉS de la última transacción
- Si un metadato no aparece, usa null`;

    const body = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: base64Pdf,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
      },
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      throw new Error(
        `Gemini API error ${data.error.code} (${data.error.status}): ${data.error.message}`
      );
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      throw new Error("Gemini no retornó contenido en la respuesta.");
    }

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

    const result = ExtractedBankStatementSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Los datos extraídos no pasan la validación: ${result.error.message}`
      );
    }

    return result.data;
  }
}
