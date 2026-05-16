-- AlterTable: add loan GL account fields to PayrollConfig
ALTER TABLE "PayrollConfig"
  ADD COLUMN "loanReceivableAccountId" TEXT,
  ADD COLUMN "disbursementBankAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollConfig" ADD CONSTRAINT "PayrollConfig_loanReceivableAccountId_fkey"
  FOREIGN KEY ("loanReceivableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollConfig" ADD CONSTRAINT "PayrollConfig_disbursementBankAccountId_fkey"
  FOREIGN KEY ("disbursementBankAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
