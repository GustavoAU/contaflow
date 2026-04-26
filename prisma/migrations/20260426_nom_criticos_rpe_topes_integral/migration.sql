-- Migration: nom_criticos_rpe_topes_integral
-- Fixes CRÍTICOS pre-lanzamiento:
--   1. RPE 0.5% (Paro Forzoso — LSSO Art. 7): rpeEnabled + rpePayableAccountId en PayrollConfig
--   2. Topes cotización IVSS/FAOV: salaryMinimumVes en PayrollConfig
--   3. affectsSalaryIntegral en PayrollConcept (LOTTT — impacto salario integral)

-- PayrollConfig: RPE + salario mínimo para topes
ALTER TABLE "PayrollConfig"
  ADD COLUMN "rpeEnabled"          BOOLEAN        NOT NULL DEFAULT true,
  ADD COLUMN "rpePayableAccountId" TEXT,
  ADD COLUMN "salaryMinimumVes"    DECIMAL(18, 2);

-- FK opcional: rpePayableAccountId → Account
ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_rpePayableAccountId_fkey"
  FOREIGN KEY ("rpePayableAccountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PayrollConcept: flag salario integral
ALTER TABLE "PayrollConcept"
  ADD COLUMN "affectsSalaryIntegral" BOOLEAN NOT NULL DEFAULT true;

-- Conceptos que NO afectan el salario integral según LOTTT:
-- CESTA_TICKET (beneficio social, no salario Art. 105 LOTTT)
-- Deducciones del obrero nunca afectan salario integral
UPDATE "PayrollConcept"
SET "affectsSalaryIntegral" = false
WHERE "code" IN ('CESTA_TICKET', 'IVSS_OBR', 'INCES_OBR', 'FAOV_OBR', 'RPE_OBR');
