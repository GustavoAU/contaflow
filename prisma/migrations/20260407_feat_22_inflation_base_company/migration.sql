-- Fase 22: Ajuste por Inflación Fiscal (INPC / VEN-NIF 3)
-- Migration 2: inflation base fields in Company

ALTER TABLE "Company"
    ADD COLUMN IF NOT EXISTS "inflationBaseYear"  INTEGER,
    ADD COLUMN IF NOT EXISTS "inflationBaseMonth" INTEGER;
