// src/modules/fixed-assets/schemas/fixed-asset.schema.ts
import { z } from "zod";

export const CreateFixedAssetSchema = z.object({
  companyId: z.string().min(1, "Empresa requerida"),
  name: z.string().min(1, "Nombre requerido").max(120),
  description: z.string().max(500).optional().nullable(),
  assetAccountId: z.string().min(1, "Cuenta del activo requerida"),
  depreciationAccountId: z.string().min(1, "Cuenta de gasto de depreciación requerida"),
  accDepreciationAccountId: z.string().min(1, "Cuenta de depreciación acumulada requerida"),
  acquisitionDate: z.coerce.date({ error: "Fecha de adquisición requerida" }),
  acquisitionCost: z
    .string()
    .min(1, "Costo de adquisición requerido")
    .refine((v) => parseFloat(v) > 0, { error: "El costo debe ser mayor a cero" }),
  residualValue: z.string().default("0"),
  usefulLifeMonths: z
    .number({ error: "Vida útil requerida" })
    .int()
    .min(1, "La vida útil debe ser al menos 1 mes"),
  depreciationMethod: z.enum(["LINEA_RECTA", "SUMA_DIGITOS", "UNIDADES_PRODUCCION"]).default("LINEA_RECTA"),
  // Solo para UNIDADES_PRODUCCION
  totalUnits: z.number().int().positive().optional().nullable(),
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

export const DisposeFixedAssetSchema = z.object({
  assetId: z.string().min(1),
  companyId: z.string().min(1),
  disposalDate: z.coerce.date({ error: "Fecha de baja requerida" }),
  saleProceeds: z.string().default("0"),  // monto recibido por la venta (0 si se desecha)
  notes: z.string().max(500).optional().nullable(),
});

export type DisposeFixedAssetInput = z.infer<typeof DisposeFixedAssetSchema>;
