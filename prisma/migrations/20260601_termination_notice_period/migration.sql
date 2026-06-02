-- C-03 / F-08: Preaviso Art. 86 LOTTT — noticePeriodDays + noticePeriodAmount
-- DISMISSAL_UNJUSTIFIED activa el preaviso calculado por tramo de antigüedad.
-- DEFAULT 0 compatible con registros existentes (sin datos históricos afectados).
ALTER TABLE "Termination"
  ADD COLUMN "noticePeriodDays"   DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN "noticePeriodAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
