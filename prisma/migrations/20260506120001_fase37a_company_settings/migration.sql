-- Fase 37A: CompanySettings + StockControlLevel enum — ADR-024 D-2.1
-- Tabla separada de Company para configuración operacional.
-- Riesgo: BAJO — tabla nueva, sin backfill.

-- Enum StockControlLevel
CREATE TYPE "StockControlLevel" AS ENUM (
  'WARN',
  'CONFIRM',
  'BLOCK'
);

-- Tabla CompanySettings
CREATE TABLE "CompanySettings" (
  "id"                TEXT NOT NULL,
  "companyId"         TEXT NOT NULL,
  "stockControlLevel" "StockControlLevel" NOT NULL DEFAULT 'WARN',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- Unique en companyId (1:1 con Company)
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_key" UNIQUE ("companyId");

-- Foreign Key
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
