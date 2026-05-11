-- Add CONTRA_ASSET to AccountType enum
-- Accumulated depreciation accounts must be typed as contra-assets, not assets.
-- Without this, they appear as negative assets in Balance General and Trial Balance.

ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'CONTRA_ASSET';

-- Update existing accumulated depreciation accounts to the correct type.
-- Pattern matches the naming convention used in seed-demo.ts.
UPDATE "Account"
SET "type" = 'CONTRA_ASSET'
WHERE "name" LIKE 'Dep. Acum.%'
  AND "type" = 'ASSET';
