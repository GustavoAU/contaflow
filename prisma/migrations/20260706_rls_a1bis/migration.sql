-- Migration: 20260706_rls_a1bis
-- ADR-007 addendum — Fase A1-bis: RLS en las ~50 tablas que quedaron fuera de
-- 20260406110000 / 20260611. Cierra el gap "tablas restantes" documentado al
-- final de 20260611_rls_force_with_check (P2 del audit integral 2026-07-05).
--
-- Diseno (mapa Explore 2026-07-06, verificado tabla por tabla en schema.prisma):
--  * NINGUNA tabla pendiente es global: todas son tenant-scoped (INPCRate y
--    PublicHoliday incluidas — tienen companyId propio).
--  * Grupo RIESGO (se consultan bajo rol authenticated HOY via withCompanyContext):
--    Company (policy self-id), CompanySettings, ExchangeRate, INPCRate,
--    InflationAdjustment, FixedAssetINPCRestatement (directas) e InvoiceTaxLine
--    (subquery via Invoice — nested create en InvoiceService bajo authenticated).
--    El contexto app.current_company_id SIEMPRE coincide con el companyId de esas
--    queries (verificado en call-sites) -> las policies pasan.
--  * El resto corre hoy como neondb_owner (BYPASSRLS) -> activarles RLS es
--    cero-riesgo runtime; defensa en profundidad para futuras rutas envueltas.
--  * ManagedClient usa despachoCompanyId (no companyId).
--  * Grants: cubiertos por 20260611 (blanket + ALTER DEFAULT PRIVILEGES) y
--    20260628 (USAGE de schema). No se requieren grants nuevos.
--  * Fail-closed: sin contexto, current_setting devuelve NULL -> 0 filas (ADR-007).

-- =====================================================================
-- GRUPO RIESGO - tablas consultadas bajo authenticated HOY
-- =====================================================================

-- Company: el tenant es su propio id (accesos bajo authenticated son a la propia empresa)
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Company";
CREATE POLICY company_isolation ON "Company"
  USING (("id")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("id")::text = current_setting('app.current_company_id', true));

ALTER TABLE "CompanySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanySettings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "CompanySettings";
CREATE POLICY company_isolation ON "CompanySettings"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "ExchangeRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ExchangeRate";
CREATE POLICY company_isolation ON "ExchangeRate"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "INPCRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "INPCRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "INPCRate";
CREATE POLICY company_isolation ON "INPCRate"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "InflationAdjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InflationAdjustment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InflationAdjustment";
CREATE POLICY company_isolation ON "InflationAdjustment"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "FixedAssetINPCRestatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FixedAssetINPCRestatement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "FixedAssetINPCRestatement";
CREATE POLICY company_isolation ON "FixedAssetINPCRestatement"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "InvoiceTaxLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceTaxLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InvoiceTaxLine";
CREATE POLICY company_isolation ON "InvoiceTaxLine"
  USING (EXISTS (
    SELECT 1 FROM "Invoice" p
    WHERE p.id = "InvoiceTaxLine"."invoiceId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Invoice" p
    WHERE p.id = "InvoiceTaxLine"."invoiceId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

-- =====================================================================
-- GRUPO DIRECTO - companyId propio, no tocadas bajo authenticated hoy
-- =====================================================================

ALTER TABLE "AbsenceType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AbsenceType" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "AbsenceType";
CREATE POLICY company_isolation ON "AbsenceType"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "BcvBenefitRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BcvBenefitRate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "BcvBenefitRate";
CREATE POLICY company_isolation ON "BcvBenefitRate"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "BenefitAccrualLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BenefitAccrualLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "BenefitAccrualLine";
CREATE POLICY company_isolation ON "BenefitAccrualLine"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "BenefitAdvance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BenefitAdvance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "BenefitAdvance";
CREATE POLICY company_isolation ON "BenefitAdvance"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "BenefitBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BenefitBalance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "BenefitBalance";
CREATE POLICY company_isolation ON "BenefitBalance"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "CompanyMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "CompanyMember";
CREATE POLICY company_isolation ON "CompanyMember"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "CustomerGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerGroup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "CustomerGroup";
CREATE POLICY company_isolation ON "CustomerGroup"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "VendorGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VendorGroup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "VendorGroup";
CREATE POLICY company_isolation ON "VendorGroup"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "ExpenseCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ExpenseCategory";
CREATE POLICY company_isolation ON "ExpenseCategory"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "ExportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExportJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ExportJob";
CREATE POLICY company_isolation ON "ExportJob"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "InventoryItemUnit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItemUnit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryItemUnit";
CREATE POLICY company_isolation ON "InventoryItemUnit"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "InventoryLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryLot";
CREATE POLICY company_isolation ON "InventoryLot"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "InventorySerial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventorySerial" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventorySerial";
CREATE POLICY company_isolation ON "InventorySerial"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "LegalThreshold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalThreshold" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "LegalThreshold";
CREATE POLICY company_isolation ON "LegalThreshold"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "OrderNumberSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderNumberSequence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "OrderNumberSequence";
CREATE POLICY company_isolation ON "OrderNumberSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "PayrollConcept" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollConcept" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PayrollConcept";
CREATE POLICY company_isolation ON "PayrollConcept"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "PayrollConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PayrollConfig";
CREATE POLICY company_isolation ON "PayrollConfig"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "ProfitSharingRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfitSharingRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ProfitSharingRecord";
CREATE POLICY company_isolation ON "ProfitSharingRecord"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "PublicHoliday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicHoliday" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PublicHoliday";
CREATE POLICY company_isolation ON "PublicHoliday"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "RolePermission";
CREATE POLICY company_isolation ON "RolePermission"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "SalaryHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalaryHistory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "SalaryHistory";
CREATE POLICY company_isolation ON "SalaryHistory"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "Termination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Termination" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "Termination";
CREATE POLICY company_isolation ON "Termination"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "VacationRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VacationRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "VacationRecord";
CREATE POLICY company_isolation ON "VacationRecord"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "VacationRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VacationRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "VacationRequest";
CREATE POLICY company_isolation ON "VacationRequest"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "EmployeeLoan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeLoan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "EmployeeLoan";
CREATE POLICY company_isolation ON "EmployeeLoan"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "DocShareToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocShareToken" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "DocShareToken";
CREATE POLICY company_isolation ON "DocShareToken"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "JournalSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalSequence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "JournalSequence";
CREATE POLICY company_isolation ON "JournalSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "FiscalReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "FiscalReport";
CREATE POLICY company_isolation ON "FiscalReport"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "caja_cajas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "caja_cajas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "caja_cajas";
CREATE POLICY company_isolation ON "caja_cajas"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "caja_caja_deposits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "caja_caja_deposits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "caja_caja_deposits";
CREATE POLICY company_isolation ON "caja_caja_deposits"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "caja_caja_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "caja_caja_movements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "caja_caja_movements";
CREATE POLICY company_isolation ON "caja_caja_movements"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "caja_caja_reimbursements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "caja_caja_reimbursements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "caja_caja_reimbursements";
CREATE POLICY company_isolation ON "caja_caja_reimbursements"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "income_distributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_distributions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "income_distributions";
CREATE POLICY company_isolation ON "income_distributions"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "subscriptions";
CREATE POLICY company_isolation ON "subscriptions"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ManagedClient: el tenant es el despacho (despachoCompanyId)
ALTER TABLE "ManagedClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManagedClient" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "ManagedClient";
CREATE POLICY company_isolation ON "ManagedClient"
  USING (("despachoCompanyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("despachoCompanyId")::text = current_setting('app.current_company_id', true));

-- =====================================================================
-- GRUPO SUBQUERY - sin companyId propio; derivan tenant del padre
-- (patron JournalEntry de 20260611: USING + WITH CHECK con EXISTS)
-- =====================================================================

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "OrderItem";
CREATE POLICY company_isolation ON "OrderItem"
  USING (EXISTS (
    SELECT 1 FROM "Order" p
    WHERE p.id = "OrderItem"."orderId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Order" p
    WHERE p.id = "OrderItem"."orderId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "QuotationItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuotationItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "QuotationItem";
CREATE POLICY company_isolation ON "QuotationItem"
  USING (EXISTS (
    SELECT 1 FROM "Quotation" p
    WHERE p.id = "QuotationItem"."quotationId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Quotation" p
    WHERE p.id = "QuotationItem"."quotationId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "PaymentBatchLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentBatchLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "PaymentBatchLine";
CREATE POLICY company_isolation ON "PaymentBatchLine"
  USING (EXISTS (
    SELECT 1 FROM "PaymentBatch" p
    WHERE p.id = "PaymentBatchLine"."paymentBatchId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "PaymentBatch" p
    WHERE p.id = "PaymentBatchLine"."paymentBatchId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "InventoryMovementLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovementLot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryMovementLot";
CREATE POLICY company_isolation ON "InventoryMovementLot"
  USING (EXISTS (
    SELECT 1 FROM "InventoryMovement" p
    WHERE p.id = "InventoryMovementLot"."movementId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryMovement" p
    WHERE p.id = "InventoryMovementLot"."movementId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "InventoryMovementSerial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovementSerial" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "InventoryMovementSerial";
CREATE POLICY company_isolation ON "InventoryMovementSerial"
  USING (EXISTS (
    SELECT 1 FROM "InventoryMovement" p
    WHERE p.id = "InventoryMovementSerial"."movementId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryMovement" p
    WHERE p.id = "InventoryMovementSerial"."movementId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "income_distribution_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_distribution_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "income_distribution_lines";
CREATE POLICY company_isolation ON "income_distribution_lines"
  USING (EXISTS (
    SELECT 1 FROM "income_distributions" p
    WHERE p.id = "income_distribution_lines"."distributionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "income_distributions" p
    WHERE p.id = "income_distribution_lines"."distributionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "income_distribution_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_distribution_audits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "income_distribution_audits";
CREATE POLICY company_isolation ON "income_distribution_audits"
  USING (EXISTS (
    SELECT 1 FROM "income_distributions" p
    WHERE p.id = "income_distribution_audits"."distributionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "income_distributions" p
    WHERE p.id = "income_distribution_audits"."distributionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "subscription_payments";
CREATE POLICY company_isolation ON "subscription_payments"
  USING (EXISTS (
    SELECT 1 FROM "subscriptions" p
    WHERE p.id = "subscription_payments"."subscriptionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "subscriptions" p
    WHERE p.id = "subscription_payments"."subscriptionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

ALTER TABLE "plan_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_change_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_isolation ON "plan_change_requests";
CREATE POLICY company_isolation ON "plan_change_requests"
  USING (EXISTS (
    SELECT 1 FROM "subscriptions" p
    WHERE p.id = "plan_change_requests"."subscriptionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "subscriptions" p
    WHERE p.id = "plan_change_requests"."subscriptionId"
      AND (p."companyId")::text = current_setting('app.current_company_id', true)
  ));

