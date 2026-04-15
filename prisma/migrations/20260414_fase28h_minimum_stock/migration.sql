-- Fase 28H: Alertas de bajo stock — campo minimumStock en InventoryItem
ALTER TABLE "InventoryItem" ADD COLUMN "minimumStock" DECIMAL(19,4);
