// src/modules/accounting/schemas/transaction.schema.ts
import { z } from "zod";
import { Decimal } from "decimal.js";
import { MAX_INVOICE_AMOUNT } from "@/lib/fiscal-validators";

function isValidAmount(v: string | undefined): boolean {
  if (!v || v === "") return true; // optional fields
  try {
    const d = new Decimal(v);
    return d.gte(0) && d.lte(new Decimal(MAX_INVOICE_AMOUNT));
  } catch {
    return false;
  }
}

export const JournalEntrySchema = z.object({
  accountId: z.string().min(1, { message: "Selecciona una cuenta" }),
  debit: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(isValidAmount, { message: "Monto fuera del rango permitido" }),
  credit: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine(isValidAmount, { message: "Monto fuera del rango permitido" }),
});

export const CreateTransactionSchema = z
  .object({
    companyId: z.string().min(1),
    userId: z.string().min(1),
    description: z.string().min(3, "Minimo 3 caracteres").max(255),
    reference: z.string().max(100).optional(),
    notes: z.string().max(500).optional(),
    date: z.coerce.date(),
    type: z.enum(["DIARIO", "APERTURA", "AJUSTE", "CIERRE"]).default("DIARIO"),
    entries: z.array(JournalEntrySchema).min(2, "Minimo 2 lineas"),
  })
  .superRefine((data, ctx) => {
    data.entries.forEach((entry, i) => {
      const hasDebit = !!entry.debit && new Decimal(entry.debit).gt(0);
      const hasCredit = !!entry.credit && new Decimal(entry.credit).gt(0);

      if (!hasDebit && !hasCredit) {
        ctx.addIssue({
          code: "custom",
          message: "Ingresa Debito o Credito",
          path: ["entries", i, "debit"],
        });
      }
      if (hasDebit && hasCredit) {
        ctx.addIssue({
          code: "custom",
          message: "Solo Debito O Credito, no ambos",
          path: ["entries", i, "debit"],
        });
      }
    });

    // Use Decimal.js for balance check — NEVER float arithmetic (ADR-006 D-2, CLAUDE.md)
    const totalDebit = data.entries.reduce((s, e) => {
      try {
        return s.plus(new Decimal(e.debit || "0"));
      } catch {
        return s;
      }
    }, new Decimal(0));

    const totalCredit = data.entries.reduce((s, e) => {
      try {
        return s.plus(new Decimal(e.credit || "0"));
      } catch {
        return s;
      }
    }, new Decimal(0));

    if (!totalDebit.eq(totalCredit)) {
      ctx.addIssue({
        code: "custom",
        message: `Asiento desbalanceado. Debitos: ${totalDebit.toFixed(2)} | Creditos: ${totalCredit.toFixed(2)}`,
        path: ["entries"],
      });
    }
  });

export const VoidTransactionSchema = z.object({
  transactionId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.string().min(10, "Minimo 10 caracteres para el motivo"),
});

export type JournalEntryInput = z.infer<typeof JournalEntrySchema>;
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;
export type VoidTransactionInput = z.infer<typeof VoidTransactionSchema>;
