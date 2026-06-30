-- ADR-023 correcciones — precisión monetaria + tasa de cambio + auditoría Restrict
--
-- Hallazgo 2 (ALTO): exchangeRate Decimal(8,6) overflowea con BCV ≥ 100 Bs/USD.
--   → Decimal(18,6) (estándar de tasas, paridad con ADR-008 indexValue).
-- Hallazgo 3 (MEDIO): montos en Decimal(18,2) violan ADR-002 (manda 19,4).
--   → Decimal(19,4) en totalAmountOriginal, totalAmountVes, amountVes.
-- Hallazgo 4 (MEDIO): income_distribution_audits FK con ON DELETE CASCADE
--   destruye el rastro de auditoría si el padre se borra (bomba latente).
--   → ON DELETE RESTRICT (ADR-003 / ADR-006 D-4 append-only).
--
-- Todas las conversiones de DECIMAL son ampliaciones (widening) → sin pérdida de datos.

-- ─── Hallazgo 2: tasa de cambio ──────────────────────────────────────────────
ALTER TABLE "income_distributions"
  ALTER COLUMN "exchangeRate" TYPE DECIMAL(18, 6);

-- ─── Hallazgo 3: precisión monetaria (19,4) ──────────────────────────────────
ALTER TABLE "income_distributions"
  ALTER COLUMN "totalAmountOriginal" TYPE DECIMAL(19, 4);
ALTER TABLE "income_distributions"
  ALTER COLUMN "totalAmountVes" TYPE DECIMAL(19, 4);
ALTER TABLE "income_distribution_lines"
  ALTER COLUMN "amountVes" TYPE DECIMAL(19, 4);

-- ─── Hallazgo 4: auditoría append-only → Restrict ────────────────────────────
ALTER TABLE "income_distribution_audits"
  DROP CONSTRAINT "income_distribution_audits_distributionId_fkey";
ALTER TABLE "income_distribution_audits"
  ADD CONSTRAINT "income_distribution_audits_distributionId_fkey"
  FOREIGN KEY ("distributionId") REFERENCES "income_distributions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
