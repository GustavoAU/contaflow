-- Fase 35G Sub-fase B — Migración 2: InventoryLot, InventorySerial, tablas intermedias
-- ADR-021 D-2, D-3, D-4, D-8
-- Backfill no requerido — tablas nuevas arrancan vacías.

-- SerialStatus enum
CREATE TYPE "SerialStatus" AS ENUM ('AVAILABLE', 'IN_TRANSIT', 'SOLD', 'VOIDED');

-- InventoryLot
CREATE TABLE "InventoryLot" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "itemId"         TEXT NOT NULL,
  "lotNumber"      TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3),
  "quantityOnHand" DECIMAL(19,4) NOT NULL,
  "notes"          TEXT,
  "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT NOT NULL,
  CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- companyId explícito en el unique: P2002 no revela lotes de otra empresa (ADR-021 CRITICAL-2)
CREATE UNIQUE INDEX "InventoryLot_companyId_itemId_lotNumber_key"
  ON "InventoryLot"("companyId", "itemId", "lotNumber");

-- CHECK no-negativo: defensa en profundidad contra bugs de service layer (ADR-021 MEDIUM-2)
ALTER TABLE "InventoryLot"
  ADD CONSTRAINT "InventoryLot_quantityOnHand_nonneg" CHECK ("quantityOnHand" >= 0);

CREATE INDEX "InventoryLot_companyId_idx" ON "InventoryLot"("companyId");
CREATE INDEX "InventoryLot_companyId_itemId_idx" ON "InventoryLot"("companyId", "itemId");
CREATE INDEX "InventoryLot_companyId_itemId_expiresAt_idx"
  ON "InventoryLot"("companyId", "itemId", "expiresAt"); -- queries FEFO

ALTER TABLE "InventoryLot"
  ADD CONSTRAINT "InventoryLot_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLot_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventorySerial
CREATE TABLE "InventorySerial" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "itemId"       TEXT NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "status"       "SerialStatus" NOT NULL DEFAULT 'AVAILABLE',
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"    TEXT NOT NULL,
  "soldAt"       TIMESTAMP(3),
  "voidedAt"     TIMESTAMP(3),
  CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);

-- companyId explícito: dos empresas distintas pueden tener el mismo serialNumber (ADR-021 D-3)
CREATE UNIQUE INDEX "InventorySerial_companyId_itemId_serialNumber_key"
  ON "InventorySerial"("companyId", "itemId", "serialNumber");

CREATE INDEX "InventorySerial_companyId_idx" ON "InventorySerial"("companyId");
CREATE INDEX "InventorySerial_companyId_itemId_idx" ON "InventorySerial"("companyId", "itemId");
CREATE INDEX "InventorySerial_companyId_itemId_status_idx"
  ON "InventorySerial"("companyId", "itemId", "status"); -- queries de disponibilidad

ALTER TABLE "InventorySerial"
  ADD CONSTRAINT "InventorySerial_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryMovementLot (tabla intermedia)
CREATE TABLE "InventoryMovementLot" (
  "id"         TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "lotId"      TEXT NOT NULL,
  "quantity"   DECIMAL(19,4) NOT NULL,
  CONSTRAINT "InventoryMovementLot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryMovementLot_movementId_lotId_key"
  ON "InventoryMovementLot"("movementId", "lotId");
CREATE INDEX "InventoryMovementLot_movementId_idx" ON "InventoryMovementLot"("movementId");
CREATE INDEX "InventoryMovementLot_lotId_idx" ON "InventoryMovementLot"("lotId");

ALTER TABLE "InventoryMovementLot"
  ADD CONSTRAINT "InventoryMovementLot_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovementLot_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- InventoryMovementSerial (tabla intermedia)
CREATE TABLE "InventoryMovementSerial" (
  "id"         TEXT NOT NULL,
  "movementId" TEXT NOT NULL,
  "serialId"   TEXT NOT NULL,
  CONSTRAINT "InventoryMovementSerial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryMovementSerial_movementId_serialId_key"
  ON "InventoryMovementSerial"("movementId", "serialId");
CREATE INDEX "InventoryMovementSerial_movementId_idx" ON "InventoryMovementSerial"("movementId");
CREATE INDEX "InventoryMovementSerial_serialId_idx" ON "InventoryMovementSerial"("serialId");

ALTER TABLE "InventoryMovementSerial"
  ADD CONSTRAINT "InventoryMovementSerial_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovementSerial_serialId_fkey"
    FOREIGN KEY ("serialId") REFERENCES "InventorySerial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
