-- Migration: 20260611_rls_force_with_check
-- ADR-007 addendum — Fix A1: FORCE RLS + WITH CHECK + tablas faltantes
--
-- Problema: neondb_owner tiene BYPASSRLS → todas las policies ignoradas.
-- FORCE ROW LEVEL SECURITY solo aplica sobre el table owner sin BYPASSRLS.
-- La solución correcta: withCompanyContext hace SET LOCAL ROLE authenticated,
-- cambiando el rol efectivo a uno sin BYPASSRLS dentro de la transacción.
--
-- ⚠️  PREREQUISITO DE DESPLIEGUE:
--   1. Aplicar esta migración en Neon SQL Editor PRIMERO.
--   2. Luego deployar el código que añade SET LOCAL ROLE en withCompanyContext.
--   Si se despliega el código antes de la migración, SET LOCAL ROLE falla
--   porque neondb_owner aún no es miembro de authenticated.
--
-- Depende de: 20260406110000_fase13d_rls_company_isolation

-- ─── Paso 1: Grants actualizados ─────────────────────────────────────────────

-- Permite que neondb_owner haga SET ROLE authenticated (necesario para
-- neutralizar su BYPASSRLS dentro de withCompanyContext).
GRANT authenticated TO neondb_owner;

-- Re-grant para tablas creadas DESPUÉS de Fase 13D (capturas sueltas).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- DEFAULT PRIVILEGES: tablas/secuencias creadas en el futuro heredan permisos.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ─── Paso 2: FORCE ROW LEVEL SECURITY — tablas existentes (Fase 13D) ─────────
-- FORCE RLS: defensa en profundidad para el table owner (sin BYPASSRLS).
-- Con SET ROLE authenticated en withCompanyContext, esto ya es redundante,
-- pero protege ante futuros cambios de roles.

ALTER TABLE "Invoice"                FORCE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "Account"                FORCE ROW LEVEL SECURITY;
ALTER TABLE "Retencion"              FORCE ROW LEVEL SECURITY;
ALTER TABLE "IGTFTransaction"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "AccountingPeriod"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "PeriodSnapshot"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYearClose"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "ControlNumberSequence"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "RetentionSequence"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "BankTransaction"        FORCE ROW LEVEL SECURITY;

-- ─── Paso 3: WITH CHECK en policies existentes ────────────────────────────────
-- Las policies de Fase 13D solo tenían USING (filtra SELECTs).
-- WITH CHECK bloquea también INSERTs/UPDATEs con companyId incorrecto.

ALTER POLICY company_isolation ON "Invoice"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "Transaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "Account"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "Retencion"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "IGTFTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "AccountingPeriod"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "PeriodSnapshot"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "FiscalYearClose"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "ControlNumberSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "RetentionSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "PaymentRecord"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER POLICY company_isolation ON "BankAccount"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- BankStatement: companyId indirecto via BankAccount (política de Fase 13D)
ALTER POLICY company_isolation ON "BankStatement"
  USING (EXISTS (
    SELECT 1 FROM "BankAccount" ba
    WHERE ba.id = "BankStatement"."bankAccountId"
      AND ba."companyId"::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "BankAccount" ba
    WHERE ba.id = "BankStatement"."bankAccountId"
      AND ba."companyId"::text = current_setting('app.current_company_id', true)
  ));

ALTER POLICY company_isolation ON "BankTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ─── Paso 4: Nuevas tablas — audit-identified + core financiero ───────────────
-- Macro para tablas con companyId directo (repetida por claridad):
--   ENABLE + FORCE + DROP IF EXISTS + CREATE POLICY (USING + WITH CHECK)

-- JournalEntry: companyId INDIRECTO via transactionId → Transaction
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "JournalEntry";
CREATE POLICY company_isolation ON "JournalEntry"
  USING (EXISTS (
    SELECT 1 FROM "Transaction" t
    WHERE t.id = "JournalEntry"."transactionId"
      AND t."companyId"::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Transaction" t
    WHERE t.id = "JournalEntry"."transactionId"
      AND t."companyId"::text = current_setting('app.current_company_id', true)
  ));

-- AuditLog (audit-identified)
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "AuditLog";
CREATE POLICY company_isolation ON "AuditLog"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- InvoicePayment (audit-identified)
ALTER TABLE "InvoicePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoicePayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InvoicePayment";
CREATE POLICY company_isolation ON "InvoicePayment"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- InvoiceLine (audit-identified)
ALTER TABLE "InvoiceLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InvoiceLine";
CREATE POLICY company_isolation ON "InvoiceLine"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- CompanyCertificate (audit-identified — Z-5: certificados digitales)
ALTER TABLE "CompanyCertificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyCertificate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "CompanyCertificate";
CREATE POLICY company_isolation ON "CompanyCertificate"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- SeniatSubmission (Z-4: transmisión SENIAT — datos fiscales críticos)
ALTER TABLE "SeniatSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeniatSubmission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "SeniatSubmission";
CREATE POLICY company_isolation ON "SeniatSubmission"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Customer
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Customer";
CREATE POLICY company_isolation ON "Customer"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Vendor
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Vendor";
CREATE POLICY company_isolation ON "Vendor"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Employee (datos RRHH sensibles)
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Employee";
CREATE POLICY company_isolation ON "Employee"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- InventoryItem
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryItem";
CREATE POLICY company_isolation ON "InventoryItem"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- InventoryMovement
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryMovement";
CREATE POLICY company_isolation ON "InventoryMovement"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Order
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Order";
CREATE POLICY company_isolation ON "Order"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Quotation
ALTER TABLE "Quotation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Quotation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Quotation";
CREATE POLICY company_isolation ON "Quotation"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- FixedAsset
ALTER TABLE "FixedAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FixedAsset" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "FixedAsset";
CREATE POLICY company_isolation ON "FixedAsset"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- DepreciationEntry
ALTER TABLE "DepreciationEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepreciationEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "DepreciationEntry";
CREATE POLICY company_isolation ON "DepreciationEntry"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Expense
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Expense";
CREATE POLICY company_isolation ON "Expense"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- Budget
ALTER TABLE "Budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Budget" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Budget";
CREATE POLICY company_isolation ON "Budget"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- BudgetLine
ALTER TABLE "BudgetLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BudgetLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "BudgetLine";
CREATE POLICY company_isolation ON "BudgetLine"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- PaymentBatch
ALTER TABLE "PaymentBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentBatch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PaymentBatch";
CREATE POLICY company_isolation ON "PaymentBatch"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- PaymentAttachment
ALTER TABLE "PaymentAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAttachment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PaymentAttachment";
CREATE POLICY company_isolation ON "PaymentAttachment"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ContactNote
ALTER TABLE "ContactNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactNote" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ContactNote";
CREATE POLICY company_isolation ON "ContactNote"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- PayrollRun
ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PayrollRun";
CREATE POLICY company_isolation ON "PayrollRun"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- PayrollRunLine
ALTER TABLE "PayrollRunLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRunLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PayrollRunLine";
CREATE POLICY company_isolation ON "PayrollRunLine"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ─── Nota: tablas restantes con companyId (pendiente Fix A1-bis) ──────────────
-- Las siguientes tablas aún no tienen RLS (queries sin withCompanyContext
-- necesitan verificación antes de activar):
-- AbsenceType, BcvBenefitRate, BenefitAccrualLine, BenefitAdvance,
-- BenefitBalance, CajaCaja*, Company, CompanyMember, CompanySettings,
-- CustomerGroup, VendorGroup, ExchangeRate, ExpenseCategory, ExportJob,
-- FixedAssetINPCRestatement, INPCRate, InflationAdjustment,
-- InventoryItemUnit, InventoryLot, InventorySerial, LegalThreshold,
-- OrderNumberSequence, PayrollConcept, PayrollConfig, ProfitSharingRecord,
-- PublicHoliday, RolePermission, SalaryHistory, Termination,
-- VacationRecord, VacationRequest, IncomeDistribution*, Subscription*
