import { z } from "zod";
import { Decimal } from "decimal.js";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";

function isPositiveDecimal(v: string) {
  try {
    const d = new Decimal(v);
    return d.gt(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
}

function isNonNegativeDecimal(v: string) {
  try {
    const d = new Decimal(v);
    return d.gte(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
}

function isValidPct(v: string) {
  try {
    const d = new Decimal(v);
    return d.gte(0) && d.lte(new Decimal("100"));
  } catch {
    return false;
  }
}

export const BatchLineInputSchema = z.object({
  invoiceId: z.string().min(1),
  amountVes: z
    .string()
    .refine(isPositiveDecimal, { error: "amountVes debe ser un número positivo dentro del rango permitido" }),
  amountOriginal: z
    .string()
    .refine(isPositiveDecimal, { error: "amountOriginal fuera del rango permitido" })
    .optional(),
  igtfAmount: z
    .string()
    .refine(isNonNegativeDecimal, { error: "igtfAmount debe ser un número no negativo" })
    .optional(),
  notes: z.string().max(500).optional(),
});

export const CreateBatchSchema = z
  .object({
    companyId: z.string().min(1),
    method: z.enum(["EFECTIVO", "TRANSFERENCIA", "PAGOMOVIL", "ZELLE", "CASHEA"]),
    totalAmountVes: z
      .string()
      .refine(isPositiveDecimal, { error: "totalAmountVes debe ser un número positivo dentro del rango permitido" }),
    currency: z.enum(["VES", "USD", "EUR"]).default("VES"),
    totalAmountOriginal: z
      .string()
      .refine(isPositiveDecimal, { error: "totalAmountOriginal fuera del rango permitido" })
      .optional(),
    exchangeRateId: z.string().optional(),
    referenceNumber: z.string().max(100).optional(),
    originBank: z.string().max(100).optional(),
    destBank: z.string().max(100).optional(),
    commissionPct: z
      .string()
      .refine(isValidPct, { error: "commissionPct debe estar entre 0 y 100" })
      .optional(),
    commissionAmount: z
      .string()
      .refine(isNonNegativeDecimal, { error: "commissionAmount debe ser un número no negativo" })
      .optional(),
    totalIgtfAmount: z
      .string()
      .refine(isNonNegativeDecimal, { error: "totalIgtfAmount debe ser un número no negativo" })
      .optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
    notes: z.string().max(500).optional(),
    idempotencyKey: z.string().min(1).max(200),
    lines: z
      .array(BatchLineInputSchema)
      .min(1, { error: "El lote debe tener al menos una línea" }),
    // ADR-030: FK opcional a BankAccount para GL auto-posting en applyBatch()
    bankAccountId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === "PAGOMOVIL" && !data.referenceNumber?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceNumber"],
        message: "Número de referencia requerido para PagoMóvil",
      });
    }
    if (data.method === "ZELLE" && (!data.totalAmountOriginal || parseFloat(data.totalAmountOriginal) <= 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["totalAmountOriginal"],
        message: "Monto en USD requerido para Zelle",
      });
    }
    if (data.method === "CASHEA" && (!data.commissionPct || parseFloat(data.commissionPct) < 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["commissionPct"],
        message: "Porcentaje de comisión requerido para Cashea",
      });
    }
  });

export const ApplyBatchSchema = z.object({
  companyId: z.string().min(1),
  batchId: z.string().min(1),
});

export const VoidBatchSchema = z.object({
  companyId: z.string().min(1),
  batchId: z.string().min(1),
  voidReason: z.string().min(1, { error: "voidReason es obligatorio" }).max(500),
});

export type CreateBatchInput = z.infer<typeof CreateBatchSchema>;
export type ApplyBatchInput = z.infer<typeof ApplyBatchSchema>;
export type VoidBatchInput = z.infer<typeof VoidBatchSchema>;
