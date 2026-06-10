// src/modules/fixed-assets/schemas/fixed-asset.schema.ts
import { z } from "zod";
import { zMoneyAmount, zMoneyPositive } from "@/lib/zod-helpers";

export const CreateFixedAssetSchema = z.object({
  companyId: z.string().min(1, "Empresa requerida"),
  name: z.string().min(1, "Nombre requerido").max(120),
  description: z.string().max(500).optional().nullable(),
  assetAccountId: z.string().min(1, "Cuenta del activo requerida"),
  depreciationAccountId: z.string().min(1, "Cuenta de gasto de depreciación requerida"),
  accDepreciationAccountId: z.string().min(1, "Cuenta de depreciación acumulada requerida"),
  acquisitionDate: z.coerce.date({ error: "Fecha de adquisición requerida" }),
  acquisitionCost: zMoneyPositive,
  // N2: moneda de adquisición y tasa BCV histórica
  acquisitionCurrency: z.enum(["VES", "USD", "EUR"]).default("VES"),
  bcvRateAtAcquisition: zMoneyAmount.optional().nullable(), // tasa BCV a la fecha de compra
  residualValue: zMoneyAmount.default("0"),
  usefulLifeMonths: z
    .number({ error: "Vida útil requerida" })
    .int()
    .min(1, "La vida útil debe ser al menos 1 mes"),
  depreciationMethod: z.enum(["LINEA_RECTA", "SUMA_DIGITOS", "UNIDADES_PRODUCCION"]).default("LINEA_RECTA"),
  // Solo para UNIDADES_PRODUCCION
  totalUnits: z.number().int().positive().optional().nullable(),
  // Ítem 40
  location:    z.string().max(200).optional().nullable(),
  responsible: z.string().max(150).optional().nullable(),
  // FC-02: campos legales SENIAT (Art. 76 ISLR / Art. 91 Código de Comercio)
  invoiceNumber:    z.string().max(50).optional().nullable(),
  providerRif:      z.string().max(20).optional().nullable(),
  serialNumber:     z.string().max(100).optional().nullable(),
  serviceStartDate: z.coerce.date().optional().nullable(),
  internalCode:     z.string().max(50).optional().nullable(),
  // Hallazgo #8: cuenta origen de la adquisición para el asiento GL inicial
  // Dr Activos Fijos Brutos (assetAccountId) / Cr acquisitionCounterpartAccountId
  // Si se omite, no se genera asiento de adquisición (el usuario debe crearlo manualmente).
  acquisitionCounterpartAccountId: z.string().optional().nullable(),
});

export type CreateFixedAssetInput = z.infer<typeof CreateFixedAssetSchema>;

export const PostMonthlyDepreciationSchema = z.object({
  companyId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export type PostMonthlyDepreciationInput = z.infer<typeof PostMonthlyDepreciationSchema>;

export const CatchUpAssetSchema = z.object({
  assetId: z.string().min(1),
  companyId: z.string().min(1),
});

export type CatchUpAssetInput = z.infer<typeof CatchUpAssetSchema>;

export const CatchUpAllAssetsSchema = z.object({
  companyId: z.string().min(1),
});

export type CatchUpAllAssetsInput = z.infer<typeof CatchUpAllAssetsSchema>;

export const DISPOSAL_REASONS = {
  OBSOLETE: "Obsolescencia / Descarte",
  SALE:     "Venta del activo",
  LOSS:     "Pérdida total / Siniestro",
  DONATION: "Donación",
} as const;

export type DisposalReason = keyof typeof DISPOSAL_REASONS;

export const DisposeFixedAssetSchema = z.object({
  assetId:   z.string().min(1),
  companyId: z.string().min(1),
  disposalDate: z.coerce.date({ error: "Fecha de baja requerida" }),
  reason: z.enum(["SALE", "LOSS", "OBSOLETE", "DONATION"]),
  saleProceeds: zMoneyAmount.default("0"),
  /** Cuenta Banco/CxC — obligatoria cuando saleProceeds > 0 */
  proceedsAccountId: z.string().optional().nullable(),
  /** Cuenta Ganancia (REVENUE) o Pérdida (EXPENSE) por baja — obligatoria cuando |gainLoss| > 0 */
  gainLossAccountId: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /** IVA Débito Fiscal en venta del activo (Art. 3 LIVA) */
  applyIva:        z.boolean().default(false),
  ivaRate:         zMoneyAmount.default("0.16"),
  ivaDFAccountId:  z.string().optional().nullable(),
  /** Reintegro IVA Crédito Fiscal por baja anticipada (Art. 66 LIVA — < 36 meses) */
  applyArt66:               z.boolean().default(false),
  art66ReintegroAmount:     zMoneyAmount.default("0"),
  art66ExpenseAccountId:    z.string().optional().nullable(),
});

export type DisposeFixedAssetInput = z.infer<typeof DisposeFixedAssetSchema>;

// ─── Reajuste por Inflación INPC (FC-01 / Art. 173 ISLR) ──────────────────────

export const PostINPCRestatementSchema = z.object({
  companyId:            z.string().min(1),
  periodYear:           z.number().int().min(2000).max(2100),
  periodMonth:          z.number().int().min(1).max(12),
  /** Cuenta de Actualización de Patrimonio (tipo EQUITY) donde se acredita el ajuste */
  patrimonioAccountId:  z.string().min(1, "Cuenta de Actualización de Patrimonio requerida"),
});

export type PostINPCRestatementInput = z.infer<typeof PostINPCRestatementSchema>;
