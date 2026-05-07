-- Fase 37A: InvoiceLine + IvaLineRate enum — ADR-024 D-1
-- Riesgo: BAJO — solo agrega tabla nueva y campos de relación inversa opcionales.
-- Sin backfill. Sin tocar filas existentes.

-- Enum IvaLineRate
CREATE TYPE "IvaLineRate" AS ENUM (
  'EXENTO',
  'REDUCIDO_8',
  'GENERAL_16',
  'ADICIONAL_31'
);

-- Tabla InvoiceLine
CREATE TABLE "InvoiceLine" (
  "id"                  TEXT NOT NULL,
  "companyId"           TEXT NOT NULL,
  "invoiceId"           TEXT NOT NULL,
  "inventoryItemId"     TEXT,
  "skuSnapshot"         TEXT,
  "nameSnapshot"        TEXT NOT NULL,
  "description"         TEXT,
  "quantity"            DECIMAL(19,4) NOT NULL,
  "unitId"              TEXT,
  "unitPriceUsd"        DECIMAL(19,4),
  "unitPriceVes"        DECIMAL(19,4) NOT NULL,
  "ivaRate"             "IvaLineRate" NOT NULL DEFAULT 'GENERAL_16',
  "subtotal"            DECIMAL(19,4) NOT NULL,
  "ivaAmount"           DECIMAL(19,4) NOT NULL,
  "total"               DECIMAL(19,4) NOT NULL,
  "luxuryGroupId"       TEXT,
  "inventoryMovementId" TEXT,
  "lineNumber"          INTEGER NOT NULL,
  "deletedAt"           TIMESTAMP(3),
  "deletedBy"           TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- Unique en inventoryMovementId (1:1 con InventoryMovement)
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_inventoryMovementId_key" UNIQUE ("inventoryMovementId");

-- Índices
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
CREATE INDEX "InvoiceLine_companyId_inventoryItemId_idx" ON "InvoiceLine"("companyId", "inventoryItemId");
CREATE INDEX "InvoiceLine_inventoryMovementId_idx" ON "InvoiceLine"("inventoryMovementId");
CREATE INDEX "InvoiceLine_invoiceId_deletedAt_idx" ON "InvoiceLine"("invoiceId", "deletedAt");

-- Foreign Keys
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "InventoryItemUnit"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_inventoryMovementId_fkey"
  FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
