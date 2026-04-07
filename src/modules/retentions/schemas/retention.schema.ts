// src/modules/retentions/schemas/retention.schema.ts
import { z } from "zod";
import { Decimal } from "decimal.js";
import { VEN_RIF_REGEX, MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";

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

// Helper: validate positive amount with ceiling (ADR-006 D-2)
function positiveBelowCeiling(v: string): boolean {
  try {
    const d = new Decimal(v);
    return d.gt(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
}

function nonNegativeBelowCeiling(v: string): boolean {
  try {
    const d = new Decimal(v);
    return d.gte(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
}

// ─── Schema de creación ───────────────────────────────────────────────────────
export const CreateRetentionSchema = z.object({
  companyId: z.string().min(1, { error: "Empresa requerida" }),
  providerName: z.string().min(1, { error: "Nombre del proveedor requerido" }),
  providerRif: z
    .string()
    .regex(VEN_RIF_REGEX, { error: "RIF inválido. Formato: J-12345678-9" }),
  invoiceNumber: z.string().min(1, { error: "Número de factura requerido" }),
  invoiceDate: z.coerce.date(),
  invoiceAmount: z
    .string()
    .refine(positiveBelowCeiling, { error: "Monto inválido o fuera del rango permitido" }),
  taxBase: z
    .string()
    .refine(positiveBelowCeiling, { error: "Base imponible inválida o fuera del rango permitido" }),
  ivaAmount: z
    .string()
    .refine(nonNegativeBelowCeiling, { error: "Monto IVA inválido o fuera del rango permitido" }),
  ivaRetentionPct: z
    .number()
    .refine((v) => v === 75 || v === 100, { error: "Porcentaje IVA debe ser 75 o 100" }),
  islrCode: z.string().optional(),
  type: z.enum(["IVA", "ISLR", "AMBAS"]),
  createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
  idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }).optional(),
});

export type CreateRetentionInput = z.infer<typeof CreateRetentionSchema>;
