-- Migration: nom_e_ut_value
-- Fase NOM-E: Valor de la Unidad Tributaria en PayrollConfig
-- ADR-015: campo nullable — si es NULL, el techo IVSS se omite y el reporte lo indica.
-- El contador actualiza este valor cuando el SENIAT publica la nueva UT anualmente.

ALTER TABLE "PayrollConfig"
  ADD COLUMN "utValue" DECIMAL(10,2) NULL;

COMMENT ON COLUMN "PayrollConfig"."utValue" IS
  'Valor de la Unidad Tributaria (UT) en Bs. — LSS Art. 62: techo IVSS = 10 UT × utValue. NULL = no configurado (reporte omite el techo).';
