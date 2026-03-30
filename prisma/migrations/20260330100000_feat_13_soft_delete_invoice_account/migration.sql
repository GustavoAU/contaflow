-- AlterTable: add deletedAt to Invoice
ALTER TABLE "Invoice" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable: add deletedAt to Account
ALTER TABLE "Account" ADD COLUMN "deletedAt" TIMESTAMP(3);
