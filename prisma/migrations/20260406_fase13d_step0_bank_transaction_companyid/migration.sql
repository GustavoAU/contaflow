-- Fase 13D Step 0: desnormalizar companyId en BankTransaction
-- Prerequisito para RLS policy (company_isolation) en BankTransaction
-- La cadena BankTransaction→BankStatement→BankAccount→companyId es demasiado
-- profunda para una USING clause de RLS. Se añade companyId directo.

-- 1. Añadir columna nullable temporalmente
ALTER TABLE "BankTransaction" ADD COLUMN "companyId" TEXT;

-- 2. Backfill desde la cadena BankStatement→BankAccount→Company
UPDATE "BankTransaction" bt
SET "companyId" = ba."companyId"
FROM "BankStatement" bs
JOIN "BankAccount" ba ON bs."bankAccountId" = ba.id
WHERE bt."statementId" = bs.id;

-- 3. Hacer NOT NULL (todos los registros existentes ya tienen valor)
ALTER TABLE "BankTransaction" ALTER COLUMN "companyId" SET NOT NULL;

-- 4. FK hacia Company
ALTER TABLE "BankTransaction"
  ADD CONSTRAINT "BankTransaction_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Índice para performance y RLS scan
CREATE INDEX "BankTransaction_companyId_idx" ON "BankTransaction"("companyId");
