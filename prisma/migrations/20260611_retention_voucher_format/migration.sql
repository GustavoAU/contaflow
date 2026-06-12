-- Migration: 20260611_retention_voucher_format
-- Fix A4: RetentionSequence mensual + comprobante formato Prov. 0049 (AAAAMM+8 dígitos)
--
-- Problema: la secuencia era global por empresa (nunca reiniciaba); el formato
-- "CR-XXXXXXXX" no cumple Prov. 0049 que exige AAAAMM + 8 dígitos secuenciales
-- con reinicio mensual.
--
-- Solución:
--   - Añadir year+month a RetentionSequence → @@unique([companyId, year, month])
--   - Índice parcial único en Retencion.voucherNumber para NULL seguro

-- ─── 1. Añadir columnas year y month (nullable para poblar primero) ───────────

ALTER TABLE "RetentionSequence"
  ADD COLUMN "year"  INTEGER,
  ADD COLUMN "month" INTEGER;

-- ─── 2. Poblar año/mes en filas existentes ────────────────────────────────────

UPDATE "RetentionSequence"
SET "year"  = EXTRACT(YEAR  FROM NOW())::INTEGER,
    "month" = EXTRACT(MONTH FROM NOW())::INTEGER;

-- ─── 3. Hacer NOT NULL ───────────────────────────────────────────────────────

ALTER TABLE "RetentionSequence"
  ALTER COLUMN "year"  SET NOT NULL,
  ALTER COLUMN "month" SET NOT NULL;

-- ─── 4. Eliminar unique constraint global por companyId ──────────────────────

ALTER TABLE "RetentionSequence"
  DROP CONSTRAINT IF EXISTS "RetentionSequence_companyId_key";

-- ─── 5. Nuevo unique compuesto (companyId, year, month) ──────────────────────

ALTER TABLE "RetentionSequence"
  ADD CONSTRAINT "RetentionSequence_companyId_year_month_key"
  UNIQUE ("companyId", "year", "month");

-- ─── 6. Índice parcial único en Retencion.voucherNumber ──────────────────────
-- NULL = sin comprobante asignado (tolerado). El unique aplica solo a los
-- valores asignados para prevenir duplicados entre retenciones de la misma empresa.

DROP INDEX IF EXISTS "Retencion_companyId_voucherNumber_unique";
CREATE UNIQUE INDEX "Retencion_companyId_voucherNumber_unique"
  ON "Retencion"("companyId", "voucherNumber")
  WHERE "voucherNumber" IS NOT NULL;
