// src/modules/ocr/schemas/invoice.schema.ts
import { z } from "zod";

export const ExtractedInvoiceSchema = z.object({
  supplierName: z.string().optional(),
  supplierRif: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  subtotal: z.string().optional(),
  taxAmount: z.string().optional(),
  totalAmount: z.string().optional(),
  currency: z.enum(["VES", "USD", "EUR"]).optional().catch(undefined),
  paymentMethod: z
    .enum(["EFECTIVO", "TARJETA", "PAGO_MOVIL", "ZELLE", "CASHEA", "TRANSFERENCIA", "OTRO"])
    .optional()
    .catch(undefined),
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
