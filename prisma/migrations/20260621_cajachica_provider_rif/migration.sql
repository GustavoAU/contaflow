-- Migration: 20260621_cajachica_provider_rif
-- Fase 3 Caja Chica (ADR-037, HC-10): RIF del proveedor en el gasto (opcional).
-- No destructiva, metadata-only, idempotente.

ALTER TABLE "caja_caja_movements"
  ADD COLUMN IF NOT EXISTS "providerRif" VARCHAR(20);
