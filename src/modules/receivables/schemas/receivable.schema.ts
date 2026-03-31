// src/modules/receivables/schemas/receivable.schema.ts
import { z } from "zod";

export const RecordPaymentSchema = z.object({
  companyId:      z.string().min(1, { error: "companyId requerido" }),
  invoiceId:      z.string().min(1, { error: "invoiceId requerido" }),
  amount:         z.string().min(1, { error: "Monto requerido" }),
  currency:       z.enum(["VES", "USD", "EUR"]).default("VES"),
  amountOriginal: z.string().optional(),
  exchangeRateId: z.string().optional(),
  method:         z.enum(["EFECTIVO", "TRANSFERENCIA", "PAGOMOVIL", "ZELLE", "CASHEA"]),
  referenceNumber: z.string().optional(),
  originBank:     z.string().optional(),
  destBank:       z.string().optional(),
  commissionPct:  z.string().optional(),
  igtfAmount:     z.string().optional(),
  date:           z.coerce.date(),
  notes:          z.string().optional(),
  createdBy:      z.string().min(1, { error: "createdBy requerido" }),
  idempotencyKey: z.string().uuid({ error: "Clave de idempotencia inválida" }),
});

export const CancelPaymentSchema = z.object({
  paymentId:   z.string().min(1),
  companyId:   z.string().min(1),
});

export const AgingReportFilterSchema = z.object({
  companyId: z.string().min(1),
  type:      z.enum(["CXC", "CXP"]),
  asOf:      z.coerce.date().optional(),
});

export const UpdatePaymentTermsSchema = z.object({
  companyId:       z.string().min(1),
  paymentTermDays: z.number().int().min(1).max(365),
});

export type RecordPaymentInput   = z.infer<typeof RecordPaymentSchema>;
export type CancelPaymentInput   = z.infer<typeof CancelPaymentSchema>;
export type AgingReportFilter    = z.infer<typeof AgingReportFilterSchema>;
export type UpdatePaymentTerms   = z.infer<typeof UpdatePaymentTermsSchema>;
