-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "resultAccountId" TEXT,
ADD COLUMN     "retainedEarningsAccountId" TEXT;

-- CreateTable
CREATE TABLE "FiscalYearClose" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedBy" TEXT NOT NULL,
    "closingTransactionId" TEXT NOT NULL,
    "appropriationTransactionId" TEXT,
    "totalRevenue" DECIMAL(19,4) NOT NULL,
    "totalExpenses" DECIMAL(19,4) NOT NULL,
    "netResult" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYearClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_closingTransactionId_key" ON "FiscalYearClose"("closingTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_appropriationTransactionId_key" ON "FiscalYearClose"("appropriationTransactionId");

-- CreateIndex
CREATE INDEX "FiscalYearClose_companyId_idx" ON "FiscalYearClose"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYearClose_companyId_year_key" ON "FiscalYearClose"("companyId", "year");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_resultAccountId_fkey" FOREIGN KEY ("resultAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_retainedEarningsAccountId_fkey" FOREIGN KEY ("retainedEarningsAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_closingTransactionId_fkey" FOREIGN KEY ("closingTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYearClose" ADD CONSTRAINT "FiscalYearClose_appropriationTransactionId_fkey" FOREIGN KEY ("appropriationTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
