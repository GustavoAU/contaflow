-- Auditoría contable: índices en JournalEntry para queries del Libro Mayor y Balance.
-- Sin estos índices, getLedgerAction genera full table scans O(n²) en tablas grandes.
-- @@index([accountId])     → filtra movimientos por cuenta en Libro Mayor y Balance General
-- @@index([transactionId]) → lookup inverso de líneas por asiento en auditoría y anulaciones

CREATE INDEX IF NOT EXISTS "JournalEntry_accountId_idx"     ON "JournalEntry"("accountId");
CREATE INDEX IF NOT EXISTS "JournalEntry_transactionId_idx" ON "JournalEntry"("transactionId");
