-- Fase 37B: Módulo Gastos — ExpenseCategory + Expense + ExpenseStatus enum — ADR-024 D-3
-- Riesgo: BAJO — tablas nuevas, sin backfill, sin tocar filas existentes.

-- Enum ExpenseStatus
CREATE TYPE "ExpenseStatus" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'VOIDED'
);

-- Tabla ExpenseCategory
CREATE TABLE "ExpenseCategory" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "accountId"   TEXT,
  "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  "deletedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- Unique + índices de ExpenseCategory
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_name_key" UNIQUE ("companyId", "name");
CREATE INDEX "ExpenseCategory_companyId_idx" ON "ExpenseCategory"("companyId");
CREATE INDEX "ExpenseCategory_companyId_deletedAt_idx" ON "ExpenseCategory"("companyId", "deletedAt");

-- FKs de ExpenseCategory
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tabla Expense
CREATE TABLE "Expense" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "vendorId"         TEXT,
  "supplierName"     TEXT,
  "concept"          TEXT NOT NULL,
  "categoryId"       TEXT NOT NULL,
  "amount"           DECIMAL(19,4) NOT NULL,
  "currency"         "Currency" NOT NULL DEFAULT 'VES',
  "exchangeRate"     DECIMAL(19,6),
  "amountVes"        DECIMAL(19,4) NOT NULL,
  "hasIva"           BOOLEAN NOT NULL DEFAULT false,
  "ivaAmount"        DECIMAL(19,4),
  "isDeductible"     BOOLEAN NOT NULL DEFAULT true,
  "invoiceNumber"    TEXT,
  "invoiceDate"      DATE,
  "attachmentUrl"    TEXT,
  "transactionId"    TEXT,
  "expenseAccountId" TEXT,
  "status"           "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "idempotencyKey"   TEXT NOT NULL,
  "deletedAt"        TIMESTAMP(3),
  "deletedBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"        TEXT NOT NULL,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- Unique + índices de Expense
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_transactionId_key" UNIQUE ("transactionId");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_idempotencyKey_key" UNIQUE ("idempotencyKey");
CREATE INDEX "Expense_companyId_idx" ON "Expense"("companyId");
CREATE INDEX "Expense_companyId_categoryId_idx" ON "Expense"("companyId", "categoryId");
CREATE INDEX "Expense_companyId_status_idx" ON "Expense"("companyId", "status");
CREATE INDEX "Expense_companyId_invoiceDate_idx" ON "Expense"("companyId", "invoiceDate");
CREATE INDEX "Expense_companyId_deletedAt_idx" ON "Expense"("companyId", "deletedAt");

-- FKs de Expense
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_expenseAccountId_fkey"
  FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
