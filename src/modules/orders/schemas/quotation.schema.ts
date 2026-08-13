// src/modules/orders/schemas/quotation.schema.ts
//
// MP-5a (ADR-042 D-1) — mismo contrato que invoice.schema: la factory varía
// VALORES (alícuotas seleccionables), nunca la ESTRUCTURA. El export del final es
// el ancla VEN permanente que usan componentes y tests.
import { z } from "zod";
import { zMoneyPositive, zBusinessDateString } from "@/lib/zod-helpers";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";
import { getDefaultFiscalConfig, memoizePerCountry } from "@/lib/countries";
import type { FiscalConfig } from "@/lib/countries/types";

export const getQuotationSchemas = memoizePerCountry(buildQuotationSchemas);

function buildQuotationSchemas(cfg: FiscalConfig) {
  const item = z.object({
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
    // Alícuotas del país. En VEN son ["0","8","16"] — el 15 de lujo NO entra
    // porque es un recargo sobre el general, nunca la tasa de un ítem suelto.
    taxRate: z.string().refine((v) => cfg.itemTaxRatePercents.includes(v), {
      error: "Alícuota IVA inválida",
    }),
  });

  const create = z.object({
    type: z.enum(["PURCHASE", "SALE"], { error: "Tipo de cotización inválido" }),
    // HIGH-1: companyId NO viene del cliente — se resuelve server-side desde member
    counterpartName: z.string().trim().min(1, "Nombre de contraparte requerido").max(200),
    counterpartRif: z.string().trim().max(20).optional(),
    validUntil: zBusinessDateString,
    notes: z.string().trim().max(500).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    items: z
      .array(item)
      .min(1, "Debe incluir al menos un ítem")
      .max(50, "Máximo 50 ítems por cotización"),
  });

  return { item, create };
}

// ─── Ancla VEN de compatibilidad (PERMANENTE — ADR-042 D-1) ───────────────────
const VEN_QUOTATION_SCHEMAS = getQuotationSchemas(getDefaultFiscalConfig());

export const QuotationItemSchema = VEN_QUOTATION_SCHEMAS.item;
export const CreateQuotationSchema = VEN_QUOTATION_SCHEMAS.create;

export type CreateQuotationInput = z.infer<typeof CreateQuotationSchema>;
