/*
  Warnings:

  - A unique constraint covering the columns `[companyId,number]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `number` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "number" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_companyId_number_key" ON "Transaction"("companyId", "number");
