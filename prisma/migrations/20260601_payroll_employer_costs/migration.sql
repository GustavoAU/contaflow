-- C-05 / F-02 / F-03: Aportes patronales + tasa BCV histórica por período
--
-- ConceptType enum: add EMPLOYER_COST (aportes patronales no afectan neto del empleado)
ALTER TYPE "ConceptType" ADD VALUE IF NOT EXISTS 'EMPLOYER_COST';

-- PayrollRun: snapshot tasa BCV activa del período + total aportes patronales
ALTER TABLE "PayrollRun"
  ADD COLUMN "bcvRateAtRun"       DECIMAL(16, 4),
  ADD COLUMN "totalEmployerCosts" DECIMAL(18, 2) NOT NULL DEFAULT 0;

-- PayrollConfig: cuentas GL para aportes patronales IVSS/INCES/FAOV/RPE
ALTER TABLE "PayrollConfig"
  ADD COLUMN "ivssPatronalAccountId"  TEXT,
  ADD COLUMN "incesPatronalAccountId" TEXT,
  ADD COLUMN "faovPatronalAccountId"  TEXT,
  ADD COLUMN "rpePatronalAccountId"   TEXT;

-- FK constraints (onDelete: Restrict — no eliminar cuentas en uso)
ALTER TABLE "PayrollConfig"
  ADD CONSTRAINT "PayrollConfig_ivssPatronalAccountId_fkey"
    FOREIGN KEY ("ivssPatronalAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_incesPatronalAccountId_fkey"
    FOREIGN KEY ("incesPatronalAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_faovPatronalAccountId_fkey"
    FOREIGN KEY ("faovPatronalAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayrollConfig_rpePatronalAccountId_fkey"
    FOREIGN KEY ("rpePatronalAccountId") REFERENCES "Account"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
