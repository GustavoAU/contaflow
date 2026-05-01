-- Fase 35F: Unidades de Medida Múltiples (UoM) — Sub-migración A: schema-only, non-breaking
-- ADR-018: stock y CPP siempre en unidad base. Conversión en service layer.

-- 1. Tabla InventoryItemUnit
CREATE TABLE "InventoryItemUnit" (
  "id"               TEXT          NOT NULL,
  "companyId"        TEXT          NOT NULL,
  "itemId"           TEXT          NOT NULL,
  "name"             TEXT          NOT NULL,
  "abbreviation"     TEXT          NOT NULL,
  "conversionFactor" DECIMAL(19,10) NOT NULL,
  "isBase"           BOOLEAN       NOT NULL DEFAULT false,
  "deletedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)  NOT NULL,
  "createdBy"        TEXT          NOT NULL,
  CONSTRAINT "InventoryItemUnit_pkey" PRIMARY KEY ("id")
);

-- Partial index: solo una unidad base por ítem — ADR-018 D-4 / security-agent CRITICAL-1
-- @@unique([itemId, isBase]) en Prisma DSL crearía constraint incorrecto sobre isBase=false.
CREATE UNIQUE INDEX "uq_inventory_item_unit_base"
  ON "InventoryItemUnit"("itemId")
  WHERE "isBase" = true;

CREATE UNIQUE INDEX "InventoryItemUnit_itemId_name_key"
  ON "InventoryItemUnit"("itemId", "name");

CREATE INDEX "InventoryItemUnit_companyId_idx"
  ON "InventoryItemUnit"("companyId");

CREATE INDEX "InventoryItemUnit_itemId_idx"
  ON "InventoryItemUnit"("itemId");

ALTER TABLE "InventoryItemUnit"
  ADD CONSTRAINT "InventoryItemUnit_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryItemUnit_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Columnas nuevas en InventoryItem (nullable inicialmente — backfill en migración B)
ALTER TABLE "InventoryItem"
  ADD COLUMN IF NOT EXISTS "baseUnitName" TEXT,
  ADD COLUMN IF NOT EXISTS "baseUnitAbbr" TEXT,
  ADD COLUMN IF NOT EXISTS "baseUnitId"   TEXT;

ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_baseUnitId_fkey"
    FOREIGN KEY ("baseUnitId") REFERENCES "InventoryItemUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deprecar unit — solo hacer nullable, no DROP (cleanup en Fase 35G o posterior)
ALTER TABLE "InventoryItem"
  ALTER COLUMN "unit" DROP NOT NULL;

-- 3. Columnas nuevas en InventoryMovement (nullable inicialmente — backfill en migración B)
ALTER TABLE "InventoryMovement"
  ADD COLUMN IF NOT EXISTS "unitId"             TEXT,
  ADD COLUMN IF NOT EXISTS "quantityInUnit"     DECIMAL(19,4),
  ADD COLUMN IF NOT EXISTS "conversionSnapshot" DECIMAL(19,10);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "InventoryItemUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
