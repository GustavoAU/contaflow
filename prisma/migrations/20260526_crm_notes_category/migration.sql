-- Q3-2: CRM básico — categorías, notas y historial de interacciones
-- Adds: ContactCategory enum, notes+category to Customer/Vendor, ContactNote model

-- 1. Enum ContactCategory
CREATE TYPE "ContactCategory" AS ENUM ('LEAD', 'REGULAR', 'VIP');

-- 2. Campos en Customer
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "notes"    TEXT,
  ADD COLUMN IF NOT EXISTS "category" "ContactCategory" NOT NULL DEFAULT 'REGULAR';

-- 3. Campos en Vendor
ALTER TABLE "Vendor"
  ADD COLUMN IF NOT EXISTS "notes"    TEXT,
  ADD COLUMN IF NOT EXISTS "category" "ContactCategory" NOT NULL DEFAULT 'REGULAR';

-- 4. Modelo ContactNote — historial de interacciones
CREATE TABLE IF NOT EXISTS "ContactNote" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"  TEXT NOT NULL,

  CONSTRAINT "ContactNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactNote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ContactNote_companyId_entityType_entityId_idx"
  ON "ContactNote"("companyId", "entityType", "entityId");

CREATE INDEX IF NOT EXISTS "ContactNote_companyId_idx"
  ON "ContactNote"("companyId");
