// src/modules/inventory/schemas/inventory-item-unit.schema.ts
import { z } from "zod";

// CRITICAL-2 (security-agent): conversionFactor como string con regex estricto,
// longitud máxima, .refine(> 0) y .trim() en campos texto (MEDIUM-1).
const conversionFactorSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(
    /^\d{1,18}(\.\d{1,10})?$/,
    "Factor de conversión inválido — use formato numérico (ej: 1000, 0.001, 1.5)"
  )
  .refine(
    (v) => parseFloat(v) > 0,
    "El factor de conversión debe ser mayor que cero"
  );

export const CreateUomSchema = z.object({
  companyId: z.string().min(1),
  itemId: z.string().min(1),
  name: z.string().min(1).max(60).trim(),            // MEDIUM-1: .trim()
  abbreviation: z.string().min(1).max(10).trim(),    // MEDIUM-1: .trim()
  conversionFactor: conversionFactorSchema,
  isBase: z.boolean().default(false),
});

export const UpdateUomSchema = z.object({
  unitId: z.string().min(1),
  companyId: z.string().min(1),
  name: z.string().min(1).max(60).trim().optional(),
  abbreviation: z.string().min(1).max(10).trim().optional(),
  // conversionFactor puede actualizarse solo si no hay movimientos referenciados
  // (HIGH-3: guard implementado en InventoryUomService)
  conversionFactor: conversionFactorSchema.optional(),
});

export const SoftDeleteUomSchema = z.object({
  unitId: z.string().min(1),
  companyId: z.string().min(1),
});

export const ListUomsSchema = z.object({
  companyId: z.string().min(1),
  itemId: z.string().min(1),
});

export type CreateUomInput = z.infer<typeof CreateUomSchema>;
export type UpdateUomInput = z.infer<typeof UpdateUomSchema>;
export type SoftDeleteUomInput = z.infer<typeof SoftDeleteUomSchema>;
export type ListUomsInput = z.infer<typeof ListUomsSchema>;
