-- Add CONTRA_ASSET to AccountType enum
-- Accumulated depreciation accounts must be typed as contra-assets, not assets.
-- Without this, they appear as negative assets in Balance General and Trial Balance.

ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'CONTRA_ASSET';

-- El UPDATE que reclasificaba las cuentas de depreciación acumulada se movió a
-- 20260511_contra_asset_backfill (ADR-057). Postgres no permite USAR un valor de enum
-- agregado en la misma transacción (error 55P04 "unsafe use of new value"), y Prisma ejecuta
-- cada archivo como una sola transacción: al repetir el historial desde cero fallaba aquí.
