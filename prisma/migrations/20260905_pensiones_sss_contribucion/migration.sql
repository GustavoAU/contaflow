-- Contribución Especial para la Protección de las Pensiones de Seguridad Social
-- Frente al Bloqueo Imperialista (G.O. 6.806 Extraordinario, 08-05-2024) —
-- Decreto 4.952 (G.O. 42.880) fija la tasa en 9%, 100% patronal, sin
-- componente obrero, sin umbral de plantilla. Verificado con contador
-- (2026-09): la base SÍ suma bonos no salariales (a diferencia de IVSS/FAOV/
-- INCES/RPE) y se calcula sobre el mes ANTERIOR, con un piso ("ingreso mínimo
-- integral", ~$240) convertido a Bs. con la tasa BCV del último día del mes
-- que se declara.

-- Dos valores nuevos de LegalThresholdType: la tasa (9%, mismo patrón que las
-- demás alícuotas) y el piso en USD (concepto nuevo, distinto de SALARY_MIN_VES).
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'PENSIONES_PAT_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'INGRESO_MINIMO_INTEGRAL_USD';

-- PayrollConfig: toggle OPT-IN (default false — ver comentario en schema.prisma)
-- + una sola cuenta GL patronal (sin componente obrero, mismo patrón que INCES_PAT).
ALTER TABLE "PayrollConfig"
  ADD COLUMN IF NOT EXISTS "pensionesEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "pensionesPatronalAccountId" TEXT;

ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_pensionesPatronalAccountId_fkey"
    FOREIGN KEY ("pensionesPatronalAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
