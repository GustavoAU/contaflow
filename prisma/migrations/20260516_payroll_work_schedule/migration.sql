-- VAC-1: jornada laboral para cómputo de días hábiles en vacaciones (LOTTT)
ALTER TABLE "PayrollConfig" ADD COLUMN "workSchedule" TEXT NOT NULL DEFAULT 'LUNES_VIERNES';
