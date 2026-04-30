-- Catch-up migration: sincroniza el historial de migraciones con el estado real de Neon.
-- Estos cambios fueron aplicados directamente al DB sin migration tracking.
-- La shadow DB los aplica aquí por primera vez; el DB real los ignora con IF NOT EXISTS / DO $$.

-- 1. AuditLog: companyId + índices (Fase 31)
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_createdAt_idx"
    ON "AuditLog"("companyId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditLog_companyId_entityName_createdAt_idx"
    ON "AuditLog"("companyId", "entityName", "createdAt" DESC);

-- 2. BankAccount: accountNumber, closingBalance, deletedAt (Fase 17B)
ALTER TABLE "BankAccount"
    ADD COLUMN IF NOT EXISTS "accountNumber"  TEXT,
    ADD COLUMN IF NOT EXISTS "closingBalance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "deletedAt"      TIMESTAMP(3);

-- 3. BankStatement: renombrar uploadedAt→importedAt, uploadedBy→importedBy, añadir deletedAt (Fase 17B)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'BankStatement' AND a.attname = 'uploadedAt' AND n.nspname = 'public' AND a.attnum > 0
    ) THEN
        ALTER TABLE "BankStatement" RENAME COLUMN "uploadedAt" TO "importedAt";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'BankStatement' AND a.attname = 'uploadedBy' AND n.nspname = 'public' AND a.attnum > 0
    ) THEN
        ALTER TABLE "BankStatement" RENAME COLUMN "uploadedBy" TO "importedBy";
    END IF;
END $$;

ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- 4. BankTransaction: deletedAt, isReconciled (Fase 17B)
ALTER TABLE "BankTransaction"
    ADD COLUMN IF NOT EXISTS "deletedAt"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "isReconciled"  BOOLEAN NOT NULL DEFAULT false;
