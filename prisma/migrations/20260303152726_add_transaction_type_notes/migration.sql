-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DIARIO', 'APERTURA', 'AJUSTE', 'CIERRE');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "type" "TransactionType" NOT NULL DEFAULT 'DIARIO';
