-- Fase 30: Exportación Masiva — ExportJob table
-- Apply with: npx prisma migrate deploy (requires DATABASE_URL_DIRECT)

CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'ERROR');

CREATE TABLE "ExportJob" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "status"    "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
  "dateFrom"  DATE NOT NULL,
  "dateTo"    DATE NOT NULL,
  "fileData"  BYTEA,
  "fileSize"  INTEGER,
  "expiresAt" TIMESTAMP(3),
  "errorMsg"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExportJob"
  ADD CONSTRAINT "ExportJob_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ExportJob_companyId_idx" ON "ExportJob"("companyId");
CREATE INDEX "ExportJob_createdBy_idx" ON "ExportJob"("createdBy");
