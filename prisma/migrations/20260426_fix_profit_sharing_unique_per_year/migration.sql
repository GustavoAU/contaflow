-- Fix: ProfitSharingRecord unique constraint per fiscal year
-- Removes isFractional from the unique key so only one record
-- per (company, employee, fiscal year) is allowed.
--
-- First, eliminate any duplicate rows keeping the most recent one
-- (seed data had both Completa + Fraccionada for the same year).
DELETE FROM "ProfitSharingRecord"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "companyId", "employeeId", "fiscalYear"
      ORDER BY "createdAt" DESC
    ) AS rn
    FROM "ProfitSharingRecord"
  ) t
  WHERE rn > 1
);

-- Drop old index (includes isFractional)
DROP INDEX IF EXISTS "ProfitSharingRecord_companyId_employeeId_fiscalYear_isFractional_key";

-- Create new tighter index (year-level uniqueness)
CREATE UNIQUE INDEX "ProfitSharingRecord_companyId_employeeId_fiscalYear_key"
  ON "ProfitSharingRecord"("companyId", "employeeId", "fiscalYear");
