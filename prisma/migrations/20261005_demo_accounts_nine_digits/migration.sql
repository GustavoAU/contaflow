-- ADR-059: las cuentas de movimiento llevan 9 dígitos. Las dos empresas demo de producción
-- ("Empresa Demo C.A." y "Tecnología y Suministros Andina, C.A.") se crearon con códigos de
-- 4 dígitos (1105, 2205...) antes de la regla. Se renumeran con el esquema d1.d2.d3d4.01.001
-- (1105 → 1.1.05.01.001), que es 1-a-1 (el prefijo identifica los 4 dígitos originales) y no
-- puede chocar con @@unique([companyId, code]).
--
-- Seguro para los asientos: JournalEntry/Transaction/GL config apuntan a la cuenta por id,
-- no por código. Verificado 2026-10-05: ningún código en `src/` y ninguna tabla guarda una
-- copia del código de cuenta. Las cuentas siguen siendo de movimiento (isPostable no cambia).
--
-- Acotado a esas dos empresas por id (en una base vacía, como la del CI, no hace nada) y
-- con rastro en AuditLog (R-6). Idempotente: tras correr, ya no queda ningún código de 4 dígitos.
INSERT INTO "AuditLog" ("id", "companyId", "entityId", "entityName", "action", "userId", "oldValue", "newValue", "createdAt")
SELECT
  gen_random_uuid()::text,
  a."companyId",
  a."id",
  'Account',
  'UPDATE',
  'system:migration-20261005_demo_accounts_nine_digits',
  jsonb_build_object('code', a."code"),
  jsonb_build_object(
    'code',
    substr(a."code", 1, 1) || '.' || substr(a."code", 2, 1) || '.' || substr(a."code", 3, 2) || '.01.001'
  ),
  now()
FROM "Account" a
WHERE a."companyId" IN ('cmmsh174m0000zsukknyhhzq5', 'cmp5mhzts000060uk2o09ktu1')
  AND a."code" ~ '^[0-9]{4}$';

UPDATE "Account"
SET "code" = substr("code", 1, 1) || '.' || substr("code", 2, 1) || '.' || substr("code", 3, 2) || '.01.001',
    "updatedAt" = now()
WHERE "companyId" IN ('cmmsh174m0000zsukknyhhzq5', 'cmp5mhzts000060uk2o09ktu1')
  AND "code" ~ '^[0-9]{4}$';
