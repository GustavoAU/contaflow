// src/modules/ocr/services/GeminiOCRService.ts
import { ExtractedInvoiceSchema, type ExtractedInvoice } from "../schemas/invoice.schema";

export class GeminiOCRService {
  static async extractFromText(text: string): Promise<ExtractedInvoice> {
    const parsed = JSON.parse(text);
    return ExtractedInvoiceSchema.parse(parsed);
  }
}
