-- CreateTable
CREATE TABLE "IGTFTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "igtfRate" DECIMAL(5,2) NOT NULL,
    "igtfAmount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "concept" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "IGTFTransaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "IGTFTransaction" ADD CONSTRAINT "IGTFTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IGTFTransaction" ADD CONSTRAINT "IGTFTransaction_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
