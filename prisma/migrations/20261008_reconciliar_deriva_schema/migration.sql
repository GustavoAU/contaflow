-- SPEC-022: reconciliar la deriva entre schema.prisma y las migraciones.
--
-- Origen: la primera corrida real de `prisma migrate diff` (SPEC-014) mostro que una base
-- reconstruida desde las migraciones NO coincidia con schema.prisma (27 sentencias) ni con
-- produccion. Esta migracion resuelve la parte que exige tocar la BD; el resto se resolvio
-- cambiando schema.prisma para que describa lo que la BD ya tiene (FKs con ON UPDATE NO ACTION,
-- updatedAt con DEFAULT, columnas TIMESTAMPTZ, ivaRetentionAmount NOT NULL, un indice declarado).
--
-- IDEMPOTENTE (IF [NOT] EXISTS) y sin tocar datos: se puede aplicar dos veces. En produccion los
-- tres DROP de la seccion 4 son no-ops (los objetos no existen; verificado el 2026-10-08).

-- Seguridad al aplicarla a mano en produccion: si otra transaccion tiene bloqueada una de estas
-- tablas, esperar a lo sumo 5 s y FALLAR en voz alta en lugar de hacer cola detras de ella y
-- bloquear a los demas. Reintentar es seguro (todo es idempotente). Aplicar en una hora tranquila.
SET lock_timeout = '5s';

-- 1. Indice que schema.prisma declara (Account.isPostable, ADR-053) y ninguna migracion creo.
CREATE INDEX IF NOT EXISTS "Account_companyId_isPostable_idx" ON "Account" ("companyId", "isPostable");

-- 2. Indice redundante: es prefijo de (companyId, employeeId) y de (companyId, status).
DROP INDEX IF EXISTS "BenefitAdvance_companyId_idx";

-- 3. El schema declara PENDING (flujo de aprobacion de prestamos); la BD tenia ACTIVE. El servicio
--    y el seed ya fijan el status explicito: esto solo protege a quien inserte sin status.
ALTER TABLE "EmployeeLoan" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- 4. Orden de migraciones del mismo dia. Prisma las aplica en orden LEXICOGRAFICO; produccion se
--    aplico a mano en orden cronologico. En una base nueva estos tres objetos sobrevivian porque
--    el DROP IF EXISTS corria ANTES de la migracion que los crea:
--      - 20260829_drop_duplicate_workshift < 20260829_overtime_entry_art183 (workShift, WorkShiftType)
--      - 20260830_payrollrun_currency_segment < 20260830_payrollrun_period_partial_unique
--        (el unico parcial por periodo, que impedia un 2o proceso del mismo periodo en otra moneda)
--    migration-order.test.ts da por neutralizado un hazard cuando una migracion POSTERIOR a la
--    ultima creacion vuelve a eliminar el objeto: esta es esa migracion.
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";
DROP TYPE IF EXISTS "WorkShiftType";
DROP INDEX IF EXISTS "PayrollRun_companyId_period_active_key";

-- 5. Nombres de indice alineados con los que calcula Prisma (solo metadatos).
--    El primero se creo con un nombre truncado a 63 caracteres; el segundo omitia companyId aunque
--    sus columnas ya eran (companyId, reimbursementNumber).
ALTER INDEX IF EXISTS "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriodMont"
  RENAME TO "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriod_key";
ALTER INDEX IF EXISTS "caja_caja_reimbursements_reimbursementNumber_key"
  RENAME TO "caja_caja_reimbursements_companyId_reimbursementNumber_key";
