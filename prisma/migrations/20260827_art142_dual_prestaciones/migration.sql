-- LOTTT Art. 142, literal (d): el trabajador "recibira por concepto de
-- prestaciones sociales el monto que resulte MAYOR" entre la garantia
-- depositada (literales a y b, con salarios historicos) y el calculo al
-- terminar la relacion (literal c: treinta dias por cada año de servicio o
-- fraccion superior a seis meses, al ULTIMO salario).
--
-- TerminationService pagaba unicamente la garantia acumulada. Como el literal
-- (c) aplica el ultimo salario a todos los años de antiguedad, en un pais con
-- salarios que suben suele ser el mayor: las liquidaciones salian cortas de
-- forma sistematica.

CREATE TYPE "PrestacionesBasis" AS ENUM (
  'GARANTIA_ACUMULADA', 'CALCULO_RETROACTIVO', 'PRIMEROS_TRES_MESES'
);

ALTER TABLE "Termination"
  ADD COLUMN "benefitsRetroactiveAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN "benefitsBasisApplied" "PrestacionesBasis" NOT NULL DEFAULT 'GARANTIA_ACUMULADA';

-- Las liquidaciones ya emitidas conservan su monto y quedan marcadas como
-- GARANTIA_ACUMULADA, que es lo que de hecho se les pago. No se recalculan:
-- reescribir una liquidacion firmada seria inventar un pago que no ocurrio.
-- Si alguna salio corta, es una diferencia que se reclama aparte.
