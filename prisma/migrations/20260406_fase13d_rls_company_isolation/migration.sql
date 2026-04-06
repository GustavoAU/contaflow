-- Fase 13D: Row Level Security — company_isolation
-- ADR-007: SET LOCAL via set_config(key, value, is_local=true) dentro de $transaction
-- Compatible con PgBouncer transaction mode (Neon serverless)
-- Prerequisito completado: BankTransaction.companyId añadido en step0

-- ─── Paso 1: Role authenticated ──────────────────────────────────────────────
-- Role sin login que el pooler de Neon usa en producción.
-- neondb_owner (usado por DATABASE_URL_DIRECT) tiene BYPASSRLS — no se toca.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ─── Paso 2: ENABLE ROW LEVEL SECURITY ───────────────────────────────────────

ALTER TABLE "Invoice"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Retencion"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IGTFTransaction"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingPeriod"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeriodSnapshot"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalYearClose"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ControlNumberSequence"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RetentionSequence"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentRecord"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatement"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankTransaction"        ENABLE ROW LEVEL SECURITY;

-- ─── Paso 3: Policies company_isolation ──────────────────────────────────────
-- current_setting('app.current_company_id', true) → missing_ok=true → devuelve NULL
-- si el parámetro no está seteado. NULL = NULL → USING evalúa a NULL → fail-closed (0 rows).

CREATE POLICY company_isolation ON "Invoice"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Transaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Account"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "Retencion"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "IGTFTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "AccountingPeriod"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "PeriodSnapshot"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "FiscalYearClose"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "ControlNumberSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "RetentionSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "PaymentRecord"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

CREATE POLICY company_isolation ON "BankAccount"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

-- BankStatement: companyId indirecto via bankAccount — subconsulta necesaria
CREATE POLICY company_isolation ON "BankStatement"
  USING (EXISTS (
    SELECT 1 FROM "BankAccount" ba
    WHERE ba.id = "BankStatement"."bankAccountId"
      AND ba."companyId"::text = current_setting('app.current_company_id', true)
  ));

-- BankTransaction: companyId directo (añadido en step0 — Fase 13D)
CREATE POLICY company_isolation ON "BankTransaction"
  USING (("companyId")::text = current_setting('app.current_company_id', true));

-- ─── Rollback (guardar para emergencias) ─────────────────────────────────────
-- Ver ADR-007 §Rollback SQL para los DROP POLICY + DISABLE ROW LEVEL SECURITY
