-- SPEC-006: el salario diario y las alícuotas de prestaciones se guardan con todos sus decimales.
--
-- La contadora (2026-10-04): "las alícuotas de prestaciones, tanto de vacaciones como de
-- utilidades, se deben dejar con todos los decimales que da (ej. 0,12353 tal cual)".
-- Eran DECIMAL(19,4) y se recortaban a 4 decimales al guardar el snapshot; el CÁLCULO ya usaba la
-- precisión completa, así que no cambia ningún monto de documento ni de asiento (ADR-058).
--
-- Ampliar la ESCALA de un NUMERIC conserva todos los valores ya guardados (RN-4). Repetible desde
-- cero (ADR-057). Aplicar en producción antes que el código que guarda 8 decimales.

ALTER TABLE "BenefitAccrualLine"
  ALTER COLUMN "dailyNormalWage" TYPE DECIMAL(19,8),
  ALTER COLUMN "profitDaysAliquot" TYPE DECIMAL(19,8),
  ALTER COLUMN "vacationBonusDaysAliquot" TYPE DECIMAL(19,8),
  ALTER COLUMN "integralDailyWage" TYPE DECIMAL(19,8);

ALTER TABLE "VacationRecord"
  ALTER COLUMN "dailyNormalWage" TYPE DECIMAL(19,8);

ALTER TABLE "ProfitSharingRecord"
  ALTER COLUMN "baseSalarySnapshot" TYPE DECIMAL(19,8);

ALTER TABLE "Termination"
  ALTER COLUMN "profitSharingBaseSalary" TYPE DECIMAL(19,8);
