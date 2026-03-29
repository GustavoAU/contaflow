-- CreateTable
CREATE TABLE "ControlNumberSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlNumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControlNumberSequence_companyId_idx" ON "ControlNumberSequence"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlNumberSequence_companyId_invoiceType_key" ON "ControlNumberSequence"("companyId", "invoiceType");

-- AddForeignKey
ALTER TABLE "ControlNumberSequence" ADD CONSTRAINT "ControlNumberSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
