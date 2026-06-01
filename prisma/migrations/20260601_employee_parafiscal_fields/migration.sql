-- F-01: Campos parafiscales y legales en Employee
-- ivssNumber, banavihNumber: registro en IVSS/Banavih (reportes Forma 14-02, FAOVWeb)
-- dependents: cargas familiares para cálculo ISLR (Decreto 1808)
-- birthDate: fecha de nacimiento para antigüedad e ISLR
-- workSchedule: jornada laboral LOTTT Arts. 173-177

-- JornadaType: distinto de WorkSchedule (días de semana), este es el tipo de jornada LOTTT
CREATE TYPE "JornadaType" AS ENUM ('DIURNA', 'NOCTURNA', 'MIXTA');

ALTER TABLE "Employee" ADD COLUMN "ivssNumber"    TEXT;
ALTER TABLE "Employee" ADD COLUMN "banavihNumber" TEXT;
ALTER TABLE "Employee" ADD COLUMN "dependents"    INTEGER;
ALTER TABLE "Employee" ADD COLUMN "birthDate"     DATE;
ALTER TABLE "Employee" ADD COLUMN "workSchedule"  "JornadaType";
