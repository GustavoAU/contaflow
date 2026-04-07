// src/modules/ocr/schemas/invoice.schema.ts
import { z } from "zod";

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
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;
