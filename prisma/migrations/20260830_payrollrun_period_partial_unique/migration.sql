-- PayrollRun: unicidad de período SOLO entre procesos vigentes.
--
-- Misma clase de defecto que ADR-035 resolvió en caja chica, en un segundo
-- módulo. `@@unique([companyId, periodStart, periodEnd])` contaba también las
-- filas CANCELLED, y `cancel()` conserva la fila (estado terminal, nunca se
-- borra). Consecuencia: cancelar una nómina inutilizaba su período PARA
-- SIEMPRE — no se podía volver a crear otra con esas fechas. Eso dejaba el
-- botón "Recalcular" estructuralmente inservible, porque su única función es
-- cancelar el borrador y recrearlo con el MISMO período.
--
-- Regla de negocio: un período puede acumular N procesos CANCELLED (historial
-- de intentos, invariante "NEVER DELETE") y a lo sumo UNO vigente
-- (DRAFT o APPROVED).
--
-- El solapamiento de períodos NO idénticos (01-15 vs 01-31) lo cubre el guard
-- aplicativo de PayrollRunService.create; este índice es el respaldo de la BD
-- contra la carrera entre dos peticiones simultáneas.

-- 1. Quitar el único incondicional. Aquí es un CONSTRAINT (verificado en
--    pg_constraint, contype='u'), pero se incluye también el DROP INDEX: sobre
--    un índice suelto, `DROP CONSTRAINT IF EXISTS` es un NO-OP SILENCIOSO y
--    dejaría el único viejo en pie sin que nada lo detecte.
ALTER TABLE "PayrollRun"
  DROP CONSTRAINT IF EXISTS "PayrollRun_companyId_periodStart_periodEnd_key";
DROP INDEX IF EXISTS "PayrollRun_companyId_periodStart_periodEnd_key";

-- 2. Único parcial: la unicidad sólo aplica a los procesos no anulados.
--    Prisma DSL no soporta WHERE en @@unique, así que vive sólo aquí y
--    schema.prisma lo documenta (verify-schema-drift.mjs excluye los parciales
--    a propósito, ver su cabecera).
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_companyId_period_active_key"
  ON "PayrollRun" ("companyId", "periodStart", "periodEnd")
  WHERE status <> 'CANCELLED';
