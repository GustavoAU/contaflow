-- ADR-056: la unicidad de (companyId, name) en Account era INCONDICIONAL —
-- bloqueaba una cuenta de TÍTULO (isPostable=false) de repetir el nombre de su padre
-- o de otra rama del plan, un patrón real y frecuente en un plan de cuentas venezolano
-- importado de otro ERP (p.ej. "1.1.03 ANTICIPOS Y AVANCES" título y
-- "1.1.03.01 ANTICIPOS Y AVANCES" título intermedio, mismo nombre, ninguna se usa en
-- asientos). Confirmado contra el `AuditLog` real de una importación: 24 de 28 "error al
-- importar" eran exactamente este choque.
--
-- Prisma no soporta WHERE en @@unique — el índice parcial vive solo aquí (ver
-- scripts/verify-schema-drift.mjs, que ya excluye índices parciales deliberadamente).
--
-- "Account_companyId_name_key" se creó como CREATE UNIQUE INDEX (no ALTER TABLE ADD
-- CONSTRAINT — verificado contra pg_constraint, 0 filas de contype='u' en Account), así
-- que DROP INDEX es correcto; DROP CONSTRAINT sobre un índice suelto es un NO-OP
-- SILENCIOSO (ver CLAUDE.md).
--
-- Verificado ANTES de crear el índice parcial (0 filas): no hay ninguna colisión de
-- nombre existente entre cuentas isPostable=true en ninguna empresa.
DROP INDEX IF EXISTS "Account_companyId_name_key";

CREATE UNIQUE INDEX "Account_companyId_name_postable_key"
  ON "Account" ("companyId", "name")
  WHERE "isPostable" = true;
