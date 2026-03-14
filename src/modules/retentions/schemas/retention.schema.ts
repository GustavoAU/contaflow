// src/modules/retentions/schemas/retention.schema.ts
import { z } from "zod";

// ─── Tabla ISLR Decreto 1808 (servicios más comunes) ─────────────────────────
export const ISLR_RATES: Record<string, { pct: number; subtrahend: number; description: string }> =
  {
    SERVICIOS_PJ: { pct: 2, subtrahend: 0, description: "Servicios — Persona Jurídica" },
    SERVICIOS_PN: { pct: 3, subtrahend: 0, description: "Servicios — Persona Natural" },
    HONORARIOS_PN: {
      pct: 5,
      subtrahend: 0,
      description: "Honorarios Profesionales — Persona Natural",
    },
    ARRENDAMIENTO_PJ: { pct: 5, subtrahend: 0, description: "Arrendamiento — Persona Jurídica" },
    ARRENDAMIENTO_PN: { pct: 5, subtrahend: 0, description: "Arrendamiento — Persona Natural" },
    FLETES_PJ: { pct: 1, subtrahend: 0, description: "Fletes — Persona Jurídica" },
    PUBLICIDAD_PJ: { pct: 3, subtrahend: 0, description: "Publicidad y Propaganda — PJ" },
  };

export const IVA_RETENTION_RATES = {
  STANDARD: { pct: 75, description: "Retención estándar 75%" },
  FULL: { pct: 100, description: "Retención total 100% (servicios sin insumos)" },
} as const;

// ─── Schema de creación ───────────────────────────────────────────────────────
export const CreateRetentionSchema = z.object({
  companyId: z.string().min(1, { error: "Empresa requerida" }),
  providerName: z.string().min(1, { error: "Nombre del proveedor requerido" }),
  providerRif: z.string().regex(/^[JVGPE]-\d{8}-\d$/, { error: "RIF inválido (ej: J-12345678-9)" }),
  invoiceNumber: z.string().min(1, { error: "Número de factura requerido" }),
  invoiceDate: z.coerce.date(),
  invoiceAmount: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, { error: "Monto inválido" }),
  taxBase: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
    error: "Base imponible inválida",
  }),
  ivaAmount: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, { error: "Monto IVA inválido" }),
  ivaRetentionPct: z
    .number()
    .refine((v) => v === 75 || v === 100, { error: "Porcentaje IVA debe ser 75 o 100" }),
  islrCode: z.string().optional(),
  type: z.enum(["IVA", "ISLR", "AMBAS"]),
  createdBy: z.string().min(1),
});

export type CreateRetentionInput = z.infer<typeof CreateRetentionSchema>;
