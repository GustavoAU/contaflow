-- N10 (resto): FKs en tablas grandes sin índice propio.
-- Los índices compuestos con companyId líder NO sirven al chequeo de FK
-- (Restrict / SetNull), que filtra por la columna FK sola → seq scan.
-- CONCURRENTLY no se usa porque corre dentro del workflow manual de Neon.

-- InvoicePayment.exchangeRateId (Restrict)
CREATE INDEX IF NOT EXISTS "InvoicePayment_exchangeRateId_idx"
  ON "InvoicePayment" ("exchangeRateId");

-- PayrollRunLine.conceptId / employeeId (Restrict)
CREATE INDEX IF NOT EXISTS "PayrollRunLine_conceptId_idx"
  ON "PayrollRunLine" ("conceptId");
CREATE INDEX IF NOT EXISTS "PayrollRunLine_employeeId_idx"
  ON "PayrollRunLine" ("employeeId");

-- BudgetLine.accountId (Restrict)
CREATE INDEX IF NOT EXISTS "BudgetLine_accountId_idx"
  ON "BudgetLine" ("accountId");

-- Expense.categoryId / vendorId (Restrict)
CREATE INDEX IF NOT EXISTS "Expense_categoryId_idx"
  ON "Expense" ("categoryId");
CREATE INDEX IF NOT EXISTS "Expense_vendorId_idx"
  ON "Expense" ("vendorId");

-- Customer.groupId / Vendor.groupId (SetNull)
CREATE INDEX IF NOT EXISTS "Customer_groupId_idx"
  ON "Customer" ("groupId");
CREATE INDEX IF NOT EXISTS "Vendor_groupId_idx"
  ON "Vendor" ("groupId");
