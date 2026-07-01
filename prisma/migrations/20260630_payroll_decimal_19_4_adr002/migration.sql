-- Follow-up revisión externa de ADRs (hallazgo 3, patrón de fondo) —
-- Cumplimiento de ADR-002: todo monto en Decimal(19,4).
--
-- Las fases NOM-C/NOM-E/F regresaron a Decimal(18,2) en montos de nómina, mientras
-- que las fases tempranas (SalaryHistory, BenefitBalance, Termination, etc.) ya usan
-- (19,4). Este migration alinea las columnas rezagadas.
--
-- (18,2)→(19,4): gana 2 decimales, baja la parte entera de 16→15 dígitos (estándar
-- ADR-002 = 19,4). Verificado en BD: ningún valor existente ≥ 10^15 (máx ~4,4M Bs).
-- NO se tocan: utValue Decimal(10,2) ni EmployeeLoan Decimal(20,2) (este último
-- necesita 18 dígitos enteros; (19,4) los reduciría a 15 — no es widening).

-- ─── LegalThreshold.value (montos Bs + porcentajes) ──────────────────────────
ALTER TABLE "LegalThreshold"
  ALTER COLUMN "value" TYPE DECIMAL(19, 4);

-- ─── PayrollConfig.salaryMinimumVes (salario mínimo Bs) ──────────────────────
ALTER TABLE "PayrollConfig"
  ALTER COLUMN "salaryMinimumVes" TYPE DECIMAL(19, 4);

-- ─── PayrollRun: totales ─────────────────────────────────────────────────────
ALTER TABLE "PayrollRun"
  ALTER COLUMN "totalEarnings" TYPE DECIMAL(19, 4);
ALTER TABLE "PayrollRun"
  ALTER COLUMN "totalDeductions" TYPE DECIMAL(19, 4);
ALTER TABLE "PayrollRun"
  ALTER COLUMN "totalNet" TYPE DECIMAL(19, 4);
ALTER TABLE "PayrollRun"
  ALTER COLUMN "totalEmployerCosts" TYPE DECIMAL(19, 4);

-- ─── PayrollRunLine: montos del motor de cálculo ─────────────────────────────
ALTER TABLE "PayrollRunLine"
  ALTER COLUMN "amount" TYPE DECIMAL(19, 4);
ALTER TABLE "PayrollRunLine"
  ALTER COLUMN "basis" TYPE DECIMAL(19, 4);
ALTER TABLE "PayrollRunLine"
  ALTER COLUMN "salarySnapshotAmount" TYPE DECIMAL(19, 4);
