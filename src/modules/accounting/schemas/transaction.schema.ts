// src/modules/accounting/schemas/transaction.schema.ts
import { z } from "zod";

export const JournalEntrySchema = z.object({
  accountId: z.string().min(1, { message: "Selecciona una cuenta" }),
  debit: z.string().optional().or(z.literal("")),
  credit: z.string().optional().or(z.literal("")),
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
      const hasDebit = !!entry.debit && Number(entry.debit) > 0;
      const hasCredit = !!entry.credit && Number(entry.credit) > 0;

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

    const totalDebit = data.entries.reduce(
      (s, e) => s + Math.round(Number(e.debit || 0) * 10000),
      0
    );
    const totalCredit = data.entries.reduce(
      (s, e) => s + Math.round(Number(e.credit || 0) * 10000),
      0
    );

    if (totalDebit !== totalCredit) {
      ctx.addIssue({
        code: "custom",
        message: `Asiento desbalanceado. Debitos: ${(totalDebit / 10000).toFixed(2)} | Creditos: ${(totalCredit / 10000).toFixed(2)}`,
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
