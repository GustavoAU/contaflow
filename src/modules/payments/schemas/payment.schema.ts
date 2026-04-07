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
    // PagoMóvil
    referenceNumber: z.string().optional(),
    originBank: z.string().optional(),
    destBank: z.string().optional(),
    // Cashea
    commissionPct: z.string().optional(),
    commissionAmount: z.string().optional(),
    // IGTF
    igtfAmount: z.string().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
    notes: z.string().optional(),
    createdBy: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.method === "PAGOMOVIL" && !data.referenceNumber?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceNumber"],
        message: "Número de referencia requerido para PagoMóvil",
      });
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
