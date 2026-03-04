-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('POSTED', 'VOIDED');

-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_transactionId_fkey";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN     "voidedById" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
