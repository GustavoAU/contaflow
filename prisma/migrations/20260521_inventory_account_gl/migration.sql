-- Fase: Error 4 dictamen SENIAT — Inventario perpetuo
-- Agrega inventoryAccountId a CompanySettings para causación correcta:
-- Dr Inventario (ASSET) al registrar compra, en lugar de Dr Costo de Ventas (EXPENSE)
-- InventoryAccountingService ya maneja Dr COGS / Cr Inventario en SALIDA de mercancía.
ALTER TABLE "CompanySettings" ADD COLUMN "inventoryAccountId" TEXT REFERENCES "Account"("id") ON DELETE RESTRICT;
