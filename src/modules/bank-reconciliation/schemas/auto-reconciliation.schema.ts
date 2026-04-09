// src/modules/bank-reconciliation/schemas/auto-reconciliation.schema.ts
import { z } from "zod";

/** Umbrales de confianza — fuente única de verdad, evita números mágicos */
export const CONFIDENCE = {
  AUTO: 90,       // score >= 90 → auto-aceptado
  SUGGESTED: 70,  // score 70-89 → requiere confirmación
} as const;

export type ConfidenceLevel = "AUTO" | "SUGGESTED" | "MANUAL";

// ─── Fila individual del extracto bancario (strings crudos de Gemini) ─────────
export const BankStatementRowSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  reference: z.string().nullable(),
  debit: z.string().nullable(),
  credit: z.string().nullable(),
  balance: z.string().nullable(),
});
export type BankStatementRow = z.infer<typeof BankStatementRowSchema>;

// ─── Resultado de extracción Gemini ──────────────────────────────────────────
export const ExtractedBankStatementSchema = z.object({
  rows: z.array(BankStatementRowSchema),
  openingBalance: z.string().nullable(),
  closingBalance: z.string().nullable(),
  accountNumber: z.string().nullable(),
  bankName: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  holderName: z.string().nullable(),
});
export type ExtractedBankStatement = z.infer<typeof ExtractedBankStatementSchema>;

// ─── Resultado de auto-conciliación ──────────────────────────────────────────
export type AutoMatchResult = {
  date: string;
  description: string;
  reference: string | null;
  amount: string;            // Decimal string positivo, 4 decimales
  type: "CREDIT" | "DEBIT";
  confidence: ConfidenceLevel;
  score: number;
  matchType: "INVOICE_PAYMENT" | "JOURNAL_ENTRY" | "PAYMENT_RECORD" | null;
  matchId: string | null;
  matchLabel: string | null;
  matchAmount: string | null;
  reason: string;
};

export type AutoReconciliationResult = {
  auto: AutoMatchResult[];
  suggested: AutoMatchResult[];
  unmatched: AutoMatchResult[];
  periodHasData: boolean;
  totalRows: number;
};

// ─── Schemas de actions ───────────────────────────────────────────────────────
export const ParseBankStatementSchema = z.object({
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  base64Pdf: z.string().min(100, { error: "PDF inválido o vacío" }),
});
export type ParseBankStatementInput = z.infer<typeof ParseBankStatementSchema>;

export const RunAutoReconciliationSchema = z.object({
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  bankAccountId: z.string().min(1, { error: "ID de cuenta bancaria requerido" }),
  rows: z.array(BankStatementRowSchema).min(1, { error: "El extracto no tiene filas" }),
  openingBalance: z.string().min(1, { error: "Saldo inicial requerido" }),
  closingBalance: z.string().min(1, { error: "Saldo final requerido" }),
});
export type RunAutoReconciliationInput = z.infer<typeof RunAutoReconciliationSchema>;

export const ConfirmSuggestedSchema = z.object({
  companyId: z.string().min(1, { error: "ID de empresa requerido" }),
  confirmations: z
    .array(
      z.object({
        bankTransactionId: z.string().min(1),
        matchType: z.enum(["INVOICE_PAYMENT", "JOURNAL_ENTRY", "PAYMENT_RECORD"]),
        matchId: z.string().min(1),
      })
    )
    .min(1, { error: "Debe seleccionar al menos una coincidencia" }),
});
export type ConfirmSuggestedInput = z.infer<typeof ConfirmSuggestedSchema>;
