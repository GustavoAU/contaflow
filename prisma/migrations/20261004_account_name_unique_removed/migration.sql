-- ADR-059 (revierte ADR-056): el NOMBRE de una cuenta deja de ser único. Regla de la
-- contadora (2026-10-04): lo único que no se repite es el CÓDIGO; títulos, subtítulos y
-- cuentas de movimiento repiten nombre en un plan real ("CAJAS" / "CAJAS" / "Caja Principal").
--
-- "Account_companyId_name_postable_key" se creó con CREATE UNIQUE INDEX (no es CONSTRAINT),
-- así que DROP INDEX es correcto; DROP CONSTRAINT sobre un índice suelto es un NO-OP SILENCIOSO
-- (ver CLAUDE.md → "DROP CONSTRAINT vs DROP INDEX"). Verificar con `npm run verify:drift`.
DROP INDEX IF EXISTS "Account_companyId_name_postable_key";

-- Regla de 9 dígitos: una cuenta con 9 o más dígitos es de movimiento. Dos cuentas de una
-- importación (1.1.06.01.001 y 1.1.06.01.002) venían marcadas como título por la columna G/M
-- del archivo, contra la regla. Solo se promueve a movimiento (nunca se degrada una cuenta
-- existente: los planes de 4 dígitos de las empresas demo siguen intactos).
UPDATE "Account"
SET "isPostable" = true
WHERE "isPostable" = false
  AND length(regexp_replace("code", '\D', '', 'g')) >= 9;
