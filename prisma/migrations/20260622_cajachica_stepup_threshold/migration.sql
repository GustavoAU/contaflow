-- Migration: 20260622_cajachica_stepup_threshold
-- ADR-039 (nota #3): umbral de step-up de caja chica configurable por empresa.
-- Nullable → si es null se usa la constante CAJA_CHICA_STEP_UP_THRESHOLD_VES. Idempotente.

ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "cajaChicaStepUpThresholdVes" DECIMAL(19,4);
