// src/modules/inflation/schemas/inpc.schema.ts
import { z } from "zod";

export const UpsertINPCRateSchema = z.object({
  companyId:  z.string().min(1, "Empresa requerida"),
  year:       z.number().int().min(2000).max(2100),
  month:      z.number().int().min(1).max(12),
  indexValue: z
    .string()
    .min(1, "Valor del índice requerido")
    .refine((v) => parseFloat(v) > 0, { error: "El índice debe ser mayor a cero" }),
  source:     z.string().max(50).optional().nullable(),
});

export type UpsertINPCRateInput = z.infer<typeof UpsertINPCRateSchema>;

export const RunInflationAdjustmentSchema = z.object({
  companyId:          z.string().min(1, "Empresa requerida"),
  periodYear:         z.number().int().min(2000).max(2100),
  periodMonth:        z.number().int().min(1).max(12),
  adjustmentAccountId: z.string().min(1, "Cuenta actualizadora requerida"),
});

export type RunInflationAdjustmentInput = z.infer<typeof RunInflationAdjustmentSchema>;

export const SetInflationBaseSchema = z.object({
  companyId:         z.string().min(1, "Empresa requerida"),
  inflationBaseYear: z.number().int().min(2000).max(2100),
  inflationBaseMonth: z.number().int().min(1).max(12),
});

export type SetInflationBaseInput = z.infer<typeof SetInflationBaseSchema>;
