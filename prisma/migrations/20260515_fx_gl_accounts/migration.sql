-- ADR-027: Diferencial cambiario NIC 21 / VEN-NIF BA-5
-- Agrega cuentas GL para ganancia y pérdida por diferencial cambiario en CompanySettings.

ALTER TABLE "CompanySettings"
ADD COLUMN "fxGainAccountId" TEXT,
ADD COLUMN "fxLossAccountId" TEXT;

ALTER TABLE "CompanySettings"
ADD CONSTRAINT "CompanySettings_fxGainAccountId_fkey"
  FOREIGN KEY ("fxGainAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "CompanySettings_fxLossAccountId_fkey"
  FOREIGN KEY ("fxLossAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
