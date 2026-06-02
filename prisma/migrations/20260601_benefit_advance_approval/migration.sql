-- F-04: Flujo solicitud/aprobación anticipo prestaciones (Art. 144 LOTTT)
-- Añade BenefitAdvanceStatus enum y campos de ciclo de vida al modelo BenefitAdvance.
-- DEFAULT 'APPROVED' preserva semántica de registros directos (admin path ya existente).

CREATE TYPE "BenefitAdvanceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "BenefitAdvance"
  ADD COLUMN "status"           "BenefitAdvanceStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "rejectionReason"  TEXT,
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt"       TIMESTAMP(3),
  ADD COLUMN "rejectedAt"       TIMESTAMP(3);

-- Índice para queries de anticipos pendientes por empresa
CREATE INDEX "BenefitAdvance_companyId_status_idx" ON "BenefitAdvance"("companyId", "status");
