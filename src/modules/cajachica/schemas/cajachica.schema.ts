import { z } from "zod";
import { zMoneyPositive } from "@/lib/zod-helpers";
import { SUPPORTED_CURRENCIES } from "@/lib/tax-config";

// ─── CajaCaja ────────────────────────────────────────────────────────────────

export const CreateCajaCajaSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1).max(255),
  accountId: z.string().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES).default("VES"),
  maxBalance: zMoneyPositive,
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
  amount: zMoneyPositive,
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
    amount: zMoneyPositive,
    currency: z.enum(SUPPORTED_CURRENCIES).default("VES"),
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
