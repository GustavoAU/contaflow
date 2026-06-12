// src/lib/journal-sequence.ts
// M8: Correlativo uniforme Libro Diario — Código de Comercio Arts. 32-36.
// Formato: YYYY-MM-NNNNNN (mensual, por empresa).
// Normalmente poblado automáticamente por el trigger DB trg_transaction_journal_number.
// Esta función es el fallback para casos donde se necesita el número antes del INSERT.

import type { Prisma } from "@prisma/client";

type Tx = Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function getNextJournalNumber(tx: Tx, companyId: string, date: Date): Promise<string> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;

  const seq = await tx.$queryRaw<[{ last_number: number }]>`
    INSERT INTO "JournalSequence" ("id", "companyId", "year", "month", "lastNumber")
    VALUES (gen_random_uuid(), ${companyId}, ${year}, ${month}, 1)
    ON CONFLICT ("companyId", "year", "month")
    DO UPDATE SET "lastNumber" = "JournalSequence"."lastNumber" + 1
    RETURNING "lastNumber" AS last_number
  `;

  const next = seq[0]?.last_number ?? 1;
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}-${String(next).padStart(6, "0")}`;
}
