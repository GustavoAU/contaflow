// src/modules/ocr/actions/ocr.actions.ts
"use server";

import { GeminiOCRService } from "../services/GeminiOCRService";
import type { ExtractedInvoice } from "../schemas/invoice.schema";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function extractInvoiceAction(
  imageBase64: string,
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf"
): Promise<ActionResult<ExtractedInvoice>> {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return { success: false, error: "GEMINI_API_KEY no configurada" };
    }

    if (!imageBase64) {
      return { success: false, error: "No se proporcionó imagen" };
    }

    const data = await GeminiOCRService.extractInvoiceData(imageBase64, mimeType);
    return { success: true, data };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { success: false, error: "No se pudo interpretar la respuesta de Gemini" };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al procesar la factura" };
  }
}
