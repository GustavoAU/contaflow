// src/modules/inventory/schemas/inventory-movement.schema.ts
import { z } from "zod";
import Decimal from "decimal.js";

export const CreateMovementSchema = z.object({
  companyId: z.string().min(1),
  itemId: z.string().min(1),
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  quantity: z.number().positive().max(1_000_000),
  // Para ENTRADA: el servicio usa este valor. Para SALIDA/AJUSTE: se ignora — se usa CPP vigente.
  unitCost: z.number().nonnegative().max(9_999_999_999).optional(),
  // Fase 35F Sub-fase B: si se especifica, quantity está en esta unidad y se convierte a base
  unitId: z.string().min(1).optional().nullable(),
  invoiceId: z.string().min(1).optional().nullable(),
  reference: z.string().max(100).trim().optional().nullable(),
  notes: z.string().max(500).trim().optional().nullable(),
  date: z.string().datetime(),
  idempotencyKey: z.string().uuid(),
});

// Fase 35G: Lot/Serial Tracking — ADR-021 D-5b
// Campos opcionales que se incluyen en postMovement cuando item.trackingType != NONE.
const LotAllocationItemSchema = z.object({
  lotId: z.string().cuid(),
  quantity: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, "Formato inválido — use decimales con hasta 4 dígitos")
    .refine((v) => new Decimal(v).greaterThan(new Decimal(0)), {
      message: "Cantidad debe ser positiva",
    }),
});

export const PostMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
  // LOT SALIDA: asignaciones manuales por lote (opcional — si omitido, FEFO automático)
  // max(50): seguridad contra transacciones Serializable grandes en Neon (ADR-021 D-5b)
  lotAllocations: z.array(LotAllocationItemSchema).max(50).optional(),
  // SERIAL SALIDA: IDs de seriales existentes a marcar como SOLD
  // max(500): Neon 30s timeout — por encima, dividir en múltiples movimientos (ADR-021 D-5b)
  serialIds: z.array(z.string().cuid()).max(500).optional(),
  // LOT ENTRADA: datos del lote a crear o encontrar por lotNumber
  lotData: z
    .object({
      lotNumber: z.string().min(1).max(100),
      expiresAt: z.string().datetime().optional().nullable(),
      notes: z.string().max(500).optional().nullable(),
      receivedAt: z.string().datetime().optional().nullable(),
    })
    .optional(),
  // SERIAL ENTRADA: números de serie a crear (uno por unidad física)
  // max(500): mismo límite que serialIds
  serialNumbers: z.array(z.string().min(1).max(100)).max(500).optional(),
});

export const VoidMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
  notes: z.string().max(500).trim().optional(),
});

export type CreateMovementInput = z.infer<typeof CreateMovementSchema>;
export type PostMovementInput = z.infer<typeof PostMovementSchema>;
export type VoidMovementInput = z.infer<typeof VoidMovementSchema>;
