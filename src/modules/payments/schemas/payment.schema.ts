import { z } from "zod";
import { Decimal } from "decimal.js";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";

export const PaymentMethodSchema = z.enum([
  "EFECTIVO",
  "TRANSFERENCIA",
  "PAGOMOVIL",
  "ZELLE",
  "CASHEA",
]);
export type PaymentMethodType = z.infer<typeof PaymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia Bancaria",
  PAGOMOVIL: "PagoMóvil",
  ZELLE: "Zelle",
  CASHEA: "Cashea",
};

export const CreatePaymentSchema = z
  .object({
    companyId: z.string().min(1),
    invoiceId: z.string().optional(),
    method: PaymentMethodSchema,
    amountVes: z.string().refine(
      (v) => {
        try {
          const d = new Decimal(v);
          return d.gt(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
        } catch {
          return false;
        }
      },
      { error: "Monto debe ser un número positivo dentro del rango permitido" }
    ),
    currency: z.enum(["VES", "USD", "EUR"]).default("VES"),
    amountOriginal: z
      .string()
      .refine(
        (v) => {
          if (!v) return true;
          try {
            const d = new Decimal(v);
            return d.gt(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
          } catch {
            return false;
          }
        },
        { error: "Monto original fuera del rango permitido" }
      )
      .optional(), // monto en moneda extranjera (Zelle)
    exchangeRateId: z.string().optional(),
    // PagoMóvil / Transferencia
    referenceNumber: z.string().max(100).optional(),
    originBank: z.string().max(100).optional(),
    destBank: z.string().max(100).optional(),
    // PagoMóvil — teléfonos (#1/#16)
    senderPhone: z.string().max(20).optional(),
    destPhone: z.string().max(20).optional(),
    // Cashea
    commissionPct: z.string().optional(),
    commissionAmount: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
    // Concepto obligatorio (#12) — mapeado al campo notes
    notes: z.string().min(1, { error: "El concepto es obligatorio" }).max(500),
    createdBy: z.string().optional(), // kept for backward compat — action uses auth() userId
    // ADR-030: FK opcional a BankAccount para GL auto-posting
    bankAccountId: z.string().optional(),
    // Riesgo-6 audit: IVA retenido por cliente CE (Prov. 0049 75%/100%) — opcional
    ivaRetentionAmount: z
      .string()
      .refine(
        (v) => {
          if (!v) return true;
          try {
            const d = new Decimal(v);
            return d.gte(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
          } catch {
            return false;
          }
        },
        { error: "IVA retenido fuera del rango permitido" }
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === "PAGOMOVIL") {
      if (!data.referenceNumber?.trim()) {
        ctx.addIssue({ code: "custom", path: ["referenceNumber"], message: "Número de referencia requerido para PagoMóvil" });
      }
      if (!data.senderPhone?.trim()) {
        ctx.addIssue({ code: "custom", path: ["senderPhone"], message: "Teléfono del emisor requerido para PagoMóvil" });
      }
      if (!data.destBank?.trim()) {
        ctx.addIssue({ code: "custom", path: ["destBank"], message: "Banco destino requerido para PagoMóvil" });
      }
    }
    if (data.method === "TRANSFERENCIA") {
      if (!data.referenceNumber?.trim()) {
        ctx.addIssue({ code: "custom", path: ["referenceNumber"], message: "Número de referencia requerido para Transferencia" });
      }
    }
    if (data.method === "ZELLE") {
      if (!data.amountOriginal || parseFloat(data.amountOriginal) <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["amountOriginal"],
          message: "Monto en USD requerido para Zelle",
        });
      }
    }
    if (data.method === "CASHEA") {
      if (!data.commissionPct || parseFloat(data.commissionPct) < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["commissionPct"],
          message: "Porcentaje de comisión requerido para Cashea",
        });
      }
    }
  });

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
