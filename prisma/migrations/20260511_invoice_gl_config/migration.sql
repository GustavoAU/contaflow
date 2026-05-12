-- ADR-026: Invoice GL auto-posting — cuentas contables en CompanySettings
ALTER TABLE "CompanySettings" ADD COLUMN "arAccountId" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "apAccountId" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "salesAccountId" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "purchaseExpenseAccountId" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "ivaDFAccountId" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "ivaCFAccountId" TEXT;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_arAccountId_fkey"
  FOREIGN KEY ("arAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_apAccountId_fkey"
  FOREIGN KEY ("apAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_salesAccountId_fkey"
  FOREIGN KEY ("salesAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_purchaseExpenseAccountId_fkey"
  FOREIGN KEY ("purchaseExpenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_ivaDFAccountId_fkey"
  FOREIGN KEY ("ivaDFAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanySettings"
  ADD CONSTRAINT "CompanySettings_ivaCFAccountId_fkey"
  FOREIGN KEY ("ivaCFAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
