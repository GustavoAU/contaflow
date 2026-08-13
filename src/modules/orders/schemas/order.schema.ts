// src/modules/orders/schemas/order.schema.ts
//
// MP-5a (ADR-042 D-1) — la parte que varía por país son los ítems, que comparte
// con cotizaciones. `ConvertOrderSchema` no tiene dependencia de país: el Nº de
// control lo valida el schema de facturas al crear el documento fiscal.

import { z } from "zod";
import { getQuotationSchemas } from "./quotation.schema";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";
import { zBusinessDateString } from "@/lib/zod-helpers";
import { getDefaultFiscalConfig, memoizePerCountry } from "@/lib/countries";
import type { FiscalConfig } from "@/lib/countries/types";

export const getOrderSchemas = memoizePerCountry(buildOrderSchemas);

function buildOrderSchemas(cfg: FiscalConfig) {
  const { item } = getQuotationSchemas(cfg);

  const create = z.object({
    type: z.enum(["PURCHASE", "SALE"], { error: "Tipo de orden inválido" }),
    // HIGH-1: companyId resuelto server-side — no en schema cliente
    quotationId: z.string().cuid().optional(),
    counterpartName: z.string().trim().min(1, "Nombre de contraparte requerido").max(200),
    counterpartRif: z.string().trim().max(20).optional(),
    expectedDate: zBusinessDateString.or(z.literal("")).optional(),
    notes: z.string().trim().max(500).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    items: z
      .array(item)
      .min(1, "Debe incluir al menos un ítem")
      .max(50, "Máximo 50 ítems por orden"),
  });

  return { create };
}

// Sin dependencia de país
export const ConvertOrderSchema = z.object({
  orderId: z.string().cuid("ID de orden inválido"),
  invoiceNumber: z.string().trim().min(1, "Número de factura requerido").max(20),
  controlNumber: z.string().trim().max(20).optional(),
  date: zBusinessDateString,
  dueDate: zBusinessDateString.or(z.literal("")).optional(),
  periodId: z.string().cuid().optional(),
});

// ─── Ancla VEN de compatibilidad (PERMANENTE — ADR-042 D-1) ───────────────────
export const CreateOrderSchema = getOrderSchemas(getDefaultFiscalConfig()).create;

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type ConvertOrderInput = z.infer<typeof ConvertOrderSchema>;
