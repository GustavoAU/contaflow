import { z } from "zod";

const MAX_AMOUNT = 10_000_000_000; // ADR-006 D-2

// ─── CajaCaja ────────────────────────────────────────────────────────────────

export const CreateCajaCajaSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).max(255),
  accountId: z.string().min(1),
  currency: z.enum(["VES", "USD", "EUR"]).default("VES"),
  maxBalance: z
    .string()
    .min(1)
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, { error: "maxBalance debe ser mayor a 0" })
    .refine((v) => Number(v) <= MAX_AMOUNT, { error: "maxBalance excede el límite permitido" }),
});

export const CloseCajaCajaSchema = z.object({
  cajaCajaId: z.string().min(1),
  companyId: z.string().min(1),
});

// ─── Deposit ─────────────────────────────────────────────────────────────────

export const CreateDepositSchema = z.object({
  companyId: z.string().min(1),
  cajaCajaId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
  amount: z
    .string()
    .min(1)
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, { error: "El monto debe ser mayor a 0" })
    .refine((v) => Number(v) <= MAX_AMOUNT, { error: "Monto excede el límite permitido" }),
  description: z.string().min(1).max(500),
  supportingDocumentId: z.string().optional(),
});

export const VoidDepositSchema = z.object({
  depositId: z.string().min(1),
  companyId: z.string().min(1),
  voidReason: z.string().min(3).max(500),
});

// ─── Movement ────────────────────────────────────────────────────────────────

export const CreateMovementSchema = z
  .object({
    companyId: z.string().min(1),
    cajaCajaId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Fecha inválida (YYYY-MM-DD)" }),
    concept: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    expenseAccountId: z.string().min(1),
    amount: z
      .string()
      .min(1)
      .refine((v) => !isNaN(Number(v)) && Number(v) > 0, { error: "El monto debe ser mayor a 0" })
      .refine((v) => Number(v) <= MAX_AMOUNT, { error: "Monto excede el límite permitido" }),
    currency: z.enum(["VES", "USD", "EUR"]).default("VES"),
    supportingDocumentId: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (d) => {
      // Soporte obligatorio si monto > VES 500,000 y currency VES
      if (d.currency === "VES" && Number(d.amount) > 500_000 && !d.supportingDocumentId) return false;
      return true;
    },
    { error: "Se requiere documento soporte para gastos mayores a VES 500,000" }
  );

export const ApproveMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
});

export const VoidMovementSchema = z.object({
  movementId: z.string().min(1),
  companyId: z.string().min(1),
  voidReason: z.string().min(3).max(500),
});

// ─── Reimbursement ───────────────────────────────────────────────────────────

export const CreateReimbursementSchema = z.object({
  companyId: z.string().min(1),
  cajaCajaId: z.string().min(1),
  monthYear: z.string().regex(/^\d{4}-\d{2}$/, { error: "Formato inválido (YYYY-MM)" }),
});

export const PostReimbursementSchema = z.object({
  reimbursementId: z.string().min(1),
  companyId: z.string().min(1),
});

export const VoidReimbursementSchema = z.object({
  reimbursementId: z.string().min(1),
  companyId: z.string().min(1),
  voidReason: z.string().min(3).max(500),
});
