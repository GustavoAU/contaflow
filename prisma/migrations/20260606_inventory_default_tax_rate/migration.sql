-- BC-001: Campo defaultTaxRate en InventoryItem — Ley IVA venezolana Art. 27
-- Permite pre-clasificar la alícuota IVA de cada producto en el catálogo,
-- evitando errores de aplicación de alícuota incorrecta al momento de facturar.

CREATE TYPE "DefaultInventoryTaxRate" AS ENUM (
  'GENERAL',
  'REDUCED',
  'LUXURY',
  'EXEMPT',
  'EXONERATED'
);

ALTER TABLE "InventoryItem"
  ADD COLUMN "defaultTaxRate" "DefaultInventoryTaxRate" NOT NULL DEFAULT 'GENERAL';
