-- Fase Retenciones: ENTERADO state + INCES/FAT fields + enteramiento fields
-- Aplicar con: npx prisma db execute --file prisma/migrations/20260512_retenciones_enterado/migration.sql

-- 1. Agregar valor ENTERADO al enum RetentionStatus
ALTER TYPE "RetentionStatus" ADD VALUE IF NOT EXISTS 'ENTERADO';

-- 2. Agregar campos INCES, FAT y enteramiento a Retencion
ALTER TABLE "Retencion"
  ADD COLUMN IF NOT EXISTS "incesAmount"       DECIMAL(19, 4),
  ADD COLUMN IF NOT EXISTS "incesRetentionPct" DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "fatAmount"         DECIMAL(19, 4),
  ADD COLUMN IF NOT EXISTS "fatRetentionPct"   DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS "enteradoAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enteradoBy"        TEXT;
