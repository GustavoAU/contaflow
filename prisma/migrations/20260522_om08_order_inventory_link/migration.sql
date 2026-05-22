-- OM-08: Vincular ítems de Cotización y Orden al catálogo de Inventario
-- Permite trazabilidad automática cotización/orden → stock sin texto libre.

-- QuotationItem
ALTER TABLE "QuotationItem" ADD COLUMN "inventoryItemId" TEXT;
ALTER TABLE "QuotationItem"
  ADD CONSTRAINT "QuotationItem_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "QuotationItem_inventoryItemId_idx" ON "QuotationItem"("inventoryItemId");

-- OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "inventoryItemId" TEXT;
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OrderItem_inventoryItemId_idx" ON "OrderItem"("inventoryItemId");
