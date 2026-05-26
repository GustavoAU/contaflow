-- Q3-3: Presupuestos y Proyecciones
-- BudgetStatus enum + Budget + BudgetLine models

CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

CREATE TABLE "Budget" (
  "id"         TEXT        NOT NULL,
  "companyId"  TEXT        NOT NULL,
  "periodYear" INTEGER     NOT NULL,
  "name"       TEXT        NOT NULL DEFAULT 'Presupuesto Anual',
  "status"     "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy"  TEXT        NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BudgetLine" (
  "id"        TEXT        NOT NULL,
  "budgetId"  TEXT        NOT NULL,
  "companyId" TEXT        NOT NULL,
  "accountId" TEXT        NOT NULL,
  "amount"    DECIMAL(19,4) NOT NULL,
  "notes"     TEXT,
  CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Budget_companyId_periodYear_name_key" ON "Budget"("companyId", "periodYear", "name");
CREATE UNIQUE INDEX "BudgetLine_budgetId_accountId_key"   ON "BudgetLine"("budgetId", "accountId");

-- Search indices
CREATE INDEX "Budget_companyId_idx"     ON "Budget"("companyId");
CREATE INDEX "BudgetLine_companyId_idx" ON "BudgetLine"("companyId");

-- Foreign keys
ALTER TABLE "Budget"     ADD CONSTRAINT "Budget_companyId_fkey"     FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetId_fkey"  FOREIGN KEY ("budgetId")  REFERENCES "Budget"("id")  ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
