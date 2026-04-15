// src/modules/orders/schemas/quotation.schema.ts
// HIGH-3: unitPrice y quantity con límites máximos/mínimos.
// MEDIUM-2: campos de texto con .trim().max().

import { z } from "zod";

export const QuotationItemSchema = z.object({
  description: z.string().trim().min(1, "Descripción requerida").max(200),
  unit: z.string().trim().min(1, "Unidad requerida").max(50),
  quantity: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
      error: "Cantidad debe ser mayor a 0",
    })
    .refine((v) => Number(v) <= 999_999, {
      error: "Cantidad excede el límite permitido",
    }),
  unitPrice: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
      error: "Precio debe ser mayor a 0",
    })
    .refine((v) => Number(v) <= 99_999_999_99, {
      error: "Precio excede el límite permitido",
    }),
  taxRate: z.enum(["0", "8", "16"], { error: "Alícuota IVA inválida" }),
});

export const CreateQuotationSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"], { error: "Tipo de cotización inválido" }),
  // HIGH-1: companyId NO viene del cliente — se resuelve server-side desde member
  counterpartName: z.string().trim().min(1, "Nombre de contraparte requerido").max(200),
  counterpartRif: z.string().trim().max(20).optional(),
  validUntil: z.string().refine((v) => !isNaN(Date.parse(v)), {
    error: "Fecha de validez inválida",
  }),
  notes: z.string().trim().max(500).optional(),
  currency: z.enum(["VES", "USD", "EUR"]).optional(),
  items: z
    .array(QuotationItemSchema)
    .min(1, "Debe incluir al menos un ítem")
    .max(50, "Máximo 50 ítems por cotización"),
});

export type CreateQuotationInput = z.infer<typeof CreateQuotationSchema>;
