-- Fase 35G Sub-fase B — Migración 1: TrackingType enum + campo en InventoryItem
-- ADR-021 D-1, D-8
-- No requiere backfill: DEFAULT 'NONE' aplica a todas las filas existentes en el mismo DDL.

-- 1. Enum TrackingType
CREATE TYPE "TrackingType" AS ENUM ('NONE', 'LOT', 'SERIAL');

-- 2. Campo en InventoryItem
ALTER TABLE "InventoryItem"
  ADD COLUMN "trackingType" "TrackingType" NOT NULL DEFAULT 'NONE';
