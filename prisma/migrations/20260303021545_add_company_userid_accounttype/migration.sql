/*
  Warnings:

  - You are about to drop the column `companyId` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `taxId` on the `Company` table. All the data in the column will be lost.
  - You are about to drop the column `credit` on the `JournalEntry` table. All the data in the column will be lost.
  - You are about to drop the column `debit` on the `JournalEntry` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Account` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `type` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Made the column `newValue` on table `AuditLog` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `updatedAt` to the `Company` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `JournalEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ACCOUNTANT', 'VIEWER');

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_companyId_fkey";

-- DropForeignKey
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_transactionId_fkey";

-- DropIndex
DROP INDEX "Company_taxId_key";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "companyId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "type" "AccountType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "timestamp",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "oldValue" JSONB,
ALTER COLUMN "newValue" SET NOT NULL;

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "taxId",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "JournalEntry" DROP COLUMN "credit",
DROP COLUMN "debit",
ADD COLUMN     "amount" DECIMAL(19,4) NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "reference" TEXT,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_name_key" ON "Account"("name");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
