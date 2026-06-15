-- ADR-034: Fase Despacho — Tier Multi-RIF
-- Migración aditiva pura: solo ADDs. Rollback = DROP TABLE + DROP COLUMN + DROP TYPE.
-- No toca filas existentes. Backfill no requerido.

-- 1. Nuevos enum types
CREATE TYPE "DespachoTier" AS ENUM ('STARTER', 'PRO', 'UNLIMITED');
CREATE TYPE "ManagedClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- 2. Campo despachoTier en Subscription (nullable — no rompe filas existentes)
ALTER TABLE "subscriptions" ADD COLUMN "despachoTier" "DespachoTier";

-- 3. Tabla ManagedClient
CREATE TABLE "ManagedClient" (
  "id"                TEXT NOT NULL,
  "despachoCompanyId" TEXT NOT NULL,
  "rif"               TEXT NOT NULL,
  "clientName"        TEXT NOT NULL,
  "ciiu"              TEXT,
  "notes"             TEXT,
  "status"            "ManagedClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "linkedCompanyId"   TEXT,
  "createdBy"         TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "deletedBy"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedClient_pkey" PRIMARY KEY ("id")
);

-- 4. Foreign keys
ALTER TABLE "ManagedClient"
  ADD CONSTRAINT "ManagedClient_despachoCompanyId_fkey"
  FOREIGN KEY ("despachoCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagedClient"
  ADD CONSTRAINT "ManagedClient_linkedCompanyId_fkey"
  FOREIGN KEY ("linkedCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Unique constraint
ALTER TABLE "ManagedClient"
  ADD CONSTRAINT "ManagedClient_despachoCompanyId_rif_key"
  UNIQUE ("despachoCompanyId", "rif");

-- 6. Indexes
CREATE INDEX "ManagedClient_despachoCompanyId_status_idx"
  ON "ManagedClient"("despachoCompanyId", "status");

CREATE INDEX "ManagedClient_despachoCompanyId_deletedAt_idx"
  ON "ManagedClient"("despachoCompanyId", "deletedAt");
