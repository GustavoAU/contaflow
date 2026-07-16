// src/modules/orders/schemas/quotation.schema.ts
import { z } from "zod";
import { zMoneyPositive, zBusinessDateString } from "@/lib/zod-helpers";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";

export const QuotationItemSchema = z.object({
  description: z.string().trim().min(1, "Descripción requerida").max(200),
  unit: z.string().trim().min(1, "Unidad requerida").max(50),
  // OM-08: vínculo opcional al catálogo de inventario. Sin este campo en el schema,
  // Zod stripeaba el ID que enviaba el form y el vínculo NUNCA se persistía
  // (hallazgo ALTO auditoría Compras/Ventas 2026-07 — la conversión a factura no
  // generaba movimiento de inventario). La validación cross-tenant vive en el service.
  inventoryItemId: z.string().cuid().nullable().optional(),
  quantity: z
    .string()
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, {
      error: "Cantidad debe ser mayor a 0",
    })
    .refine((v) => Number(v) <= 999_999, {
      error: "Cantidad excede el límite permitido",
    }),
  unitPrice: zMoneyPositive,
  taxRate: z.enum(["0", "8", "16"], { error: "Alícuota IVA inválida" }),
});

export const CreateQuotationSchema = z.object({
  type: z.enum(["PURCHASE", "SALE"], { error: "Tipo de cotización inválido" }),
  // HIGH-1: companyId NO viene del cliente — se resuelve server-side desde member
  counterpartName: z.string().trim().min(1, "Nombre de contraparte requerido").max(200),
  counterpartRif: z.string().trim().max(20).optional(),
  validUntil: zBusinessDateString,
  notes: z.string().trim().max(500).optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  items: z
    .array(QuotationItemSchema)
    .min(1, "Debe incluir al menos un ítem")
    .max(50, "Máximo 50 ítems por cotización"),
});

export type CreateQuotationInput = z.infer<typeof CreateQuotationSchema>;
