-- Reclasifica las cuentas de depreciación acumulada como CONTRA_ASSET (ADR-057).
--
-- Antes vivía en 20260511_contra_asset junto al ALTER TYPE ... ADD VALUE, y Postgres no
-- permite usar un valor de enum nuevo en la misma transacción (55P04). Separado en su propia
-- migración, el valor ya está confirmado cuando este UPDATE corre.
--
-- IDEMPOTENTE: en una BD donde 20260511_contra_asset ya reclasificó estas cuentas (producción),
-- el WHERE no encuentra filas con type = 'ASSET' y no cambia nada.
-- Pattern matches the naming convention used in seed-demo.ts.
UPDATE "Account"
SET "type" = 'CONTRA_ASSET'
WHERE "name" LIKE 'Dep. Acum.%'
  AND "type" = 'ASSET';
