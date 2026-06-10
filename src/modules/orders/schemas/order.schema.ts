// src/modules/orders/schemas/order.schema.ts

import { z } from "zod";
import { QuotationItemSchema } from "./quotation.schema";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";

export const CreateOrderSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"], { error: "Tipo de orden inválido" }),
  // HIGH-1: companyId resuelto server-side — no en schema cliente
  quotationId: z.string().cuid().optional(),
  counterpartName: z.string().trim().min(1, "Nombre de contraparte requerido").max(200),
  counterpartRif: z.string().trim().max(20).optional(),
  expectedDate: z.string().refine((v) => !v || !isNaN(Date.parse(v)), {
    error: "Fecha esperada inválida",
  }).optional(),
  notes: z.string().trim().max(500).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  items: z
    .array(QuotationItemSchema)
    .min(1, "Debe incluir al menos un ítem")
    .max(50, "Máximo 50 ítems por orden"),
});

export const ConvertOrderSchema = z.object({
  orderId: z.string().cuid("ID de orden inválido"),
  invoiceNumber: z.string().trim().min(1, "Número de factura requerido").max(20),
  controlNumber: z.string().trim().max(20).optional(),
  date: z.string().refine((v) => !isNaN(Date.parse(v)), { error: "Fecha inválida" }),
  dueDate: z.string().refine((v) => !v || !isNaN(Date.parse(v)), {
    error: "Fecha de vencimiento inválida",
  }).optional(),
  periodId: z.string().cuid().optional(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type ConvertOrderInput = z.infer<typeof ConvertOrderSchema>;
