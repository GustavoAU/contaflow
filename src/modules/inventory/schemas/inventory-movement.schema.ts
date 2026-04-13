// src/modules/inventory/schemas/inventory-movement.schema.ts
import { z } from "zod";

export const CreateMovementSchema = z.object({
  companyId: z.string().min(1),
  itemId: z.string().min(1),
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  quantity: z.number().positive().max(1_000_000),
  // Para ENTRADA: el servicio usa este valor. Para SALIDA/AJUSTE: se ignora — se usa CPP vigente.
  unitCost: z.number().nonnegative().max(9_999_999_999).optional(),
  invoiceId: z.string().min(1).optional().nullable(),
  reference: z.string().max(100).trim().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
  date: z.string().datetime(),
  idempotencyKey: z.string().uuid(),
});

export const PostMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
});

export const VoidMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
  notes: z.string().max(500).trim().optional(),
});

export type CreateMovementInput = z.infer<typeof CreateMovementSchema>;
export type PostMovementInput = z.infer<typeof PostMovementSchema>;
export type VoidMovementInput = z.infer<typeof VoidMovementSchema>;
