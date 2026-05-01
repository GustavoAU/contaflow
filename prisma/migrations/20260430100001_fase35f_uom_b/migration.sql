-- Fase 35F: Sub-migración B — backfill de datos existentes
-- Depende de: 20260430100000_fase35f_uom_a (debe aplicarse primero)
--
-- Nota LOW-1 (security-agent): IDs generados con gen_random_uuid() tienen formato UUID en lugar
-- de CUID. Coexisten como strings opacos — sin impacto funcional. Las unidades creadas via API
-- post-migración usarán CUID normalmente. Riesgo: bajo (solo cosmético en audit logs).

-- 1. Por cada InventoryItem, crear una InventoryItemUnit base
--    usando el valor actual de "unit" (o 'unidad'/'UN' si es NULL).
INSERT INTO "InventoryItemUnit" (
  "id", "companyId", "itemId", "name", "abbreviation",
  "conversionFactor", "isBase", "createdAt", "updatedAt", "createdBy"
)
SELECT
  gen_random_uuid()::text,
  i."companyId",
  i."id",
  COALESCE(NULLIF(TRIM(i."unit"), ''), 'unidad'),
  UPPER(LEFT(COALESCE(NULLIF(TRIM(i."unit"), ''), 'UN'), 10)),
  1.0000000000,
  true,
  NOW(),
  NOW(),
  'SYSTEM_MIGRATION_35F'
FROM "InventoryItem" i
WHERE NOT EXISTS (
  SELECT 1 FROM "InventoryItemUnit" u
  WHERE u."itemId" = i."id" AND u."isBase" = true
);

-- 2. Sincronizar baseUnitName / baseUnitAbbr / baseUnitId en InventoryItem
UPDATE "InventoryItem" i
SET
  "baseUnitName" = u."name",
  "baseUnitAbbr" = u."abbreviation",
  "baseUnitId"   = u."id"
FROM "InventoryItemUnit" u
WHERE u."itemId" = i."id"
  AND u."isBase" = true
  AND i."baseUnitId" IS NULL;

-- 3. Backfill InventoryMovement: movimientos existentes estaban todos en unidad base
UPDATE "InventoryMovement"
SET
  "quantityInUnit"     = "quantity",
  "conversionSnapshot" = 1.0000000000
WHERE "quantityInUnit" IS NULL;

-- Verificación: debe devolver 0 registros. Si devuelve > 0, hay ítems sin unidad base.
-- SELECT COUNT(*) FROM "InventoryItem" WHERE "baseUnitId" IS NULL;
-- SELECT COUNT(*) FROM "InventoryMovement" WHERE "quantityInUnit" IS NULL;
