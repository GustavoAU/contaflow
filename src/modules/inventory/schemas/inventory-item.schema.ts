// src/modules/inventory/schemas/inventory-item.schema.ts
import { z } from "zod";

export const ITEM_TYPES = ["GOODS", "SERVICE", "RAW_MATERIAL", "FINISHED_GOOD"] as const;
export type ItemTypeValue = (typeof ITEM_TYPES)[number];

// Tipos que requieren movimientos físicos y cuentas contables
export const PHYSICAL_ITEM_TYPES = new Set<ItemTypeValue>(["GOODS", "RAW_MATERIAL", "FINISHED_GOOD"]);

// BC-001: Alícuota IVA por defecto — Ley IVA venezolana Art. 27
export const TAX_RATE_OPTIONS = ["GENERAL", "REDUCED", "LUXURY", "EXEMPT", "EXONERATED"] as const;
export type DefaultTaxRate = (typeof TAX_RATE_OPTIONS)[number];

export const TAX_RATE_LABELS: Record<DefaultTaxRate, string> = {
  GENERAL:    "16% — Alícuota general",
  REDUCED:    "8% — Reducida (canasta básica, medicamentos)",
  LUXURY:     "31% — Lujo (16% + 15% adicional)",
  EXEMPT:     "0% — Exento (Ley IVA Art. 15)",
  EXONERATED: "0% — Exonerado por decreto presidencial (Ley IVA Art. 19)",
};

export const CreateInventoryItemSchema = z
  .object({
    companyId: z.string().min(1),
    sku: z.string().min(1).max(50).trim(),
    name: z.string().min(1).max(120).trim(),
    description: z.string().max(500).trim().optional().nullable(),
    itemType: z.enum(ITEM_TYPES).default("GOODS"),
    defaultTaxRate: z.enum(TAX_RATE_OPTIONS).default("GENERAL"),
    minimumStock: z.number().min(0).optional().nullable(),
    accountId: z.string().min(1).optional().nullable(),
    cogsAccountId: z.string().min(1).optional().nullable(),
  })
  .refine(
    (d) => {
      // Productos físicos requieren cuentas contables para la contabilización
      if (PHYSICAL_ITEM_TYPES.has(d.itemType)) {
        return !!d.accountId && !!d.cogsAccountId;
      }
      return true; // SERVICE no requiere cuentas
    },
    {
      message: "Los productos físicos (Mercancía, MP, PT) requieren Cuenta de Inventario y Cuenta COGS para la contabilización.",
      path: ["accountId"],
    }
  );

export const UpdateInventoryItemSchema = z.object({
  itemId: z.string().min(1),
  companyId: z.string().min(1),
  sku: z.string().min(1).max(50).trim().optional(),
  name: z.string().min(1).max(120).trim().optional(),
  description: z.string().max(500).trim().optional().nullable(),
  itemType: z.enum(ITEM_TYPES).optional(),
  defaultTaxRate: z.enum(TAX_RATE_OPTIONS).optional(),
  minimumStock: z.number().min(0).optional().nullable(),
  accountId: z.string().min(1).optional().nullable(),
  cogsAccountId: z.string().min(1).optional().nullable(),
});

export type CreateInventoryItemInput = z.infer<typeof CreateInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof UpdateInventoryItemSchema>;
