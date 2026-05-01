// src/modules/inventory/schemas/inventory-item.schema.ts
import { z } from "zod";

export const CreateInventoryItemSchema = z.object({
  companyId: z.string().min(1),
  sku: z.string().min(1).max(50).trim(),
  name: z.string().min(1).max(120).trim(),
  description: z.string().max(500).trim().optional().nullable(),
  accountId: z.string().min(1).optional().nullable(),
  cogsAccountId: z.string().min(1).optional().nullable(),
});

export const UpdateInventoryItemSchema = z.object({
  itemId: z.string().min(1),
  companyId: z.string().min(1),
  sku: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(500).trim().optional().nullable(),
  accountId: z.string().min(1).optional().nullable(),
  cogsAccountId: z.string().min(1).optional().nullable(),
});

export type CreateInventoryItemInput = z.infer<typeof CreateInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof UpdateInventoryItemSchema>;
