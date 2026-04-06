// src/modules/bank-reconciliation/schemas/bank-statement.schema.ts
import { z } from "zod";

export const CreateBankStatementSchema = z.object({
  bankAccountId: z.string().min(1),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  openingBalance: z.string().regex(/^-?\d+(\.\d{1,4})?$/, { error: "Monto inválido" }),
  closingBalance: z.string().regex(/^-?\d+(\.\d{1,4})?$/, { error: "Monto inválido" }),
  importedBy: z.string().min(1),
});

export type CreateBankStatementInput = z.infer<typeof CreateBankStatementSchema>;

export const CreateBankTransactionSchema = z.object({
  statementId: z.string().min(1),
  date: z.coerce.date(),
  description: z.string().min(1).max(500),
  type: z.enum(["CREDIT", "DEBIT"]),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, { error: "Monto inválido" }),
  reference: z.string().max(100).optional(),
});

export type CreateBankTransactionInput = z.infer<typeof CreateBankTransactionSchema>;

export const MatchTransactionSchema = z.object({
  bankTransactionId: z.string().min(1),
  matchedPaymentId: z.string().min(1),
  matchedBy: z.string().min(1),
});

export type MatchTransactionInput = z.infer<typeof MatchTransactionSchema>;
