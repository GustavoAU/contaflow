// src/modules/income-distribution/schemas/income-distribution.schema.ts

import { z } from "zod";
import { Decimal } from "decimal.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const decimalString = z
  .string()
  .refine((v) => { try { return new Decimal(v).greaterThan(0); } catch { return false; } },
    { error: "Debe ser un número positivo" });

const percentageString = z
  .string()
  .refine((v) => { try { const d = new Decimal(v); return d.greaterThan(0) && d.lessThanOrEqualTo(100); } catch { return false; } },
    { error: "Porcentaje debe estar entre 0.01 y 100" });

// ─── Line ─────────────────────────────────────────────────────────────────────

export const IncomeDistributionLineSchema = z.object({
  recipientCompanyId: z.string().cuid({ error: "ID de empresa destinataria inválido" }),
  accountId: z.string().cuid({ error: "ID de cuenta inválido" }),
  percentageShare: percentageString,
  lineDescription: z.string().max(500).optional(),
});

// ─── Create ───────────────────────────────────────────────────────────────────

export const CreateIncomeDistributionSchema = z
  .object({
    companyId: z.string().cuid(),
    date: z.string().date({ error: "Fecha inválida (YYYY-MM-DD)" }),
    description: z.string().max(500).optional(),
    currencyCode: z.string().length(3).default("VES"),
    totalAmountOriginal: decimalString,
    exchangeRate: z
      .string()
      .refine((v) => { try { return new Decimal(v).greaterThan(0); } catch { return false; } },
        { error: "Tasa de cambio debe ser positiva" })
      .default("1"),
    originAccountId: z.string().cuid({ error: "Cuenta origen inválida" }),
    lines: z
      .array(IncomeDistributionLineSchema)
      .min(2, { error: "Se requieren al menos 2 destinatarios" })
      .max(20, { error: "Máximo 20 destinatarios" }),
  })
  // V-1: suma de porcentajes = 100
  .refine(
    (d) => {
      try {
        const sum = d.lines.reduce((acc, l) => acc.plus(new Decimal(l.percentageShare)), new Decimal(0));
        return sum.equals(new Decimal(100));
      } catch { return false; }
    },
    { error: "La suma de los porcentajes debe ser exactamente 100%" }
  )
  // V-2: destinatarios únicos
  .refine(
    (d) => {
      const ids = d.lines.map((l) => l.recipientCompanyId);
      return new Set(ids).size === ids.length;
    },
    { error: "No puede haber destinatarios duplicados" }
  );

export type CreateIncomeDistributionInput = z.infer<typeof CreateIncomeDistributionSchema>;

// ─── Apply / Void ─────────────────────────────────────────────────────────────

export const ApplyDistributionSchema = z.object({
  distributionId: z.string().cuid(),
  companyId: z.string().cuid(),
});

export const VoidDistributionSchema = z.object({
  distributionId: z.string().cuid(),
  companyId: z.string().cuid(),
  voidReason: z.string().min(3, { error: "Motivo de anulación requerido (mín. 3 caracteres)" }).max(500),
});
