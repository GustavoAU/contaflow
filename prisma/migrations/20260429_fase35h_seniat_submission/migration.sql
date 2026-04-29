-- Fase 35H: PA-121 — UserRole SENIAT + SeniatSubmission Outbox (ADR-019 D-1 / D-3)

-- 1. Agregar valor SENIAT al enum UserRole
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SENIAT';

-- 2. Crear enum SubmissionStatus
DO $$ BEGIN
  CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Crear tabla SeniatSubmission
CREATE TABLE IF NOT EXISTS "SeniatSubmission" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "invoiceId"    TEXT NOT NULL,
  "status"       "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "payload"      JSONB NOT NULL,
  "lastResponse" JSONB,
  "sentAt"       TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SeniatSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeniatSubmission_invoiceId_key" UNIQUE ("invoiceId"),
  CONSTRAINT "SeniatSubmission_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SeniatSubmission_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 4. Índices para el worker QStash y monitoreo
CREATE INDEX IF NOT EXISTS "SeniatSubmission_companyId_status_idx"
  ON "SeniatSubmission"("companyId", "status");

CREATE INDEX IF NOT EXISTS "SeniatSubmission_status_createdAt_idx"
  ON "SeniatSubmission"("status", "createdAt");
