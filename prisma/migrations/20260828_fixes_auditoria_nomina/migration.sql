-- Hallazgos de la auditoria de seguridad sobre la rama ADR-045.

-- E1 (HIGH). Un concepto personalizado nacia como SALARIO_NORMAL y entraba solo
-- en la base de cotizaciones, sin ninguna via en la aplicacion para sacarlo.
-- Antes de esta rama los conceptos personalizados no tocaban la base, asi que
-- era una regresion. El default pasa a NO_SALARIAL: retener de mas al trabajador
-- no se revierte (Art. 103 del Reglamento del Seguro Social: si el patrono no
-- descuenta en su oportunidad "no podra hacerlo despues"), mientras que retener
-- de menos deja una deuda de la empresa con el instituto, que si es subsanable.
ALTER TABLE "PayrollConcept"
  ALTER COLUMN "salaryNature" SET DEFAULT 'NO_SALARIAL';

-- E5 (MEDIUM). schema.prisma declaraba @default(30) y @default(15) desde el
-- barrido de constantes legales, pero ninguna migracion lo aplico: la BD seguia
-- en 15 y 7, los minimos de la LOT de 1997. Y como ninguna ruta de la aplicacion
-- escribe estas columnas, el default de BD ES el valor efectivo de toda empresa.
ALTER TABLE "PayrollConfig"
  ALTER COLUMN "profitDays" SET DEFAULT 30,
  ALTER COLUMN "vacationBonusDays" SET DEFAULT 15;

-- B3 (HIGH). Subir las filas existentes por debajo del minimo legal.
-- LOTTT Art. 131: utilidades, minimo treinta dias.
-- LOTTT Art. 192: bono vacacional, minimo quince dias.
UPDATE "PayrollConfig" SET "profitDays" = 30 WHERE "profitDays" < 30;
UPDATE "PayrollConfig" SET "vacationBonusDays" = 15 WHERE "vacationBonusDays" < 15;
