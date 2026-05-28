// src/modules/ocr/schemas/invoice.schema.ts
import { z } from "zod";

// ─── Riesgo de campo extraído por OCR ─────────────────────────────────────────
// Generado en GeminiOCRService cuando un campo fiscal crítico no supera
// la validación de formato post-extracción (PA-00071: RIF, N° Control).
export const FieldRiskSchema = z.object({
  field: z.string(),
  label: z.string(),
  issue: z.string(),
  severity: z.enum(["critical", "warn"]),
});
export type FieldRisk = z.infer<typeof FieldRiskSchema>;

export const ExtractedInvoiceSchema = z.object({
  // ── Identificación del emisor ──────────────────────────────────────────────
  razonSocial: z.string().optional(),
  rif: z.string().optional(),
  // ── Identificación del documento ──────────────────────────────────────────
  numeroFactura: z.string().optional(),
  numeroControl: z.string().optional(),
  fechaEmision: z.string().optional(),
  // ── Bases imponibles e impuestos (VEN-NIF alícuotas) ──────────────────────
  baseImponibleGeneral: z.string().optional(),   // base para IVA 16% (General)
  ivaGeneral: z.string().optional(),             // IVA 16%
  baseImponibleReducida: z.string().optional(),  // base para IVA 8% (Reducida)
  ivaReducido: z.string().optional(),            // IVA 8%
  baseImponibleAdicional: z.string().optional(), // base para IVA +15% (Lujo)
  ivaAdicional: z.string().optional(),           // IVA adicional lujo
  montoTotal: z.string().optional(),
  // ── Metadatos del pago ─────────────────────────────────────────────────────
  currency: z.enum(["VES", "USD", "EUR"]).optional().catch(undefined),
  paymentMethod: z
    .enum(["EFECTIVO", "TARJETA", "PAGO_MOVIL", "ZELLE", "CASHEA", "TRANSFERENCIA", "OTRO"])
    .optional()
    .catch(undefined),
  // ── Líneas de detalle ──────────────────────────────────────────────────────
  items: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.string().optional(),
        unitPrice: z.string().optional(),
        totalPrice: z.string().optional(),
      })
    )
    .optional(),
  notes: z.string().optional(),
  // ── Riesgos detectados post-extracción ────────────────────────────────────
  // Campos fiscales críticos (RIF, N° Control) que no superan validación
  // de formato local. Ver GeminiOCRService para la lógica de detección.
  _fieldRisks: z.array(FieldRiskSchema).optional(),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
