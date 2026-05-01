-- Fase 35F: Sub-migración C — NOT NULL constraints post-backfill
-- Depende de: 20260430100001_fase35f_uom_b (backfill completo)
-- Ejecutar SOLO después de verificar:
--   SELECT COUNT(*) FROM "InventoryItem" WHERE "baseUnitId" IS NULL;  → debe ser 0
--   SELECT COUNT(*) FROM "InventoryMovement" WHERE "quantityInUnit" IS NULL;  → debe ser 0

ALTER TABLE "InventoryItem"
  ALTER COLUMN "baseUnitName" SET NOT NULL,
  ALTER COLUMN "baseUnitAbbr" SET NOT NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "quantityInUnit"     SET NOT NULL,
  ALTER COLUMN "conversionSnapshot" SET NOT NULL;

-- NOTA: "unit" en InventoryItem queda nullable (DEPRECADO).
-- Se eliminará en Fase 35G o cleanup posterior una vez que:
--   1. Ningún servicio lea InventoryItem.unit directamente (búsqueda de código).
--   2. Al menos un ciclo de operaciones completo haya corrido con el nuevo schema.
-- Ver ADR-018 Riesgo 5 y D-4.
