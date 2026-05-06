-- Drop columna `unit` legacy de InventoryItem
-- Fue reemplazada por InventoryItemUnit en Fase 35F (ADR-018).
-- La columna se dejó nullable para compatibilidad durante la migración; ya no es referenciada en código.
ALTER TABLE "InventoryItem" DROP COLUMN IF EXISTS "unit";
