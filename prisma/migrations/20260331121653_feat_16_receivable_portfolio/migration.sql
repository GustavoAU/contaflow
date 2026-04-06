-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'VOIDED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "paymentTermDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "pendingAmount" DECIMAL(19,4),
ADD COLUMN     "totalAmountVes" DECIMAL(19,4);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'VES',
    "amountOriginal" DECIMAL(19,4),
    "exchangeRateId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "originBank" TEXT,
    "destBank" TEXT,
    "commissionPct" DECIMAL(5,4),
    "igtfAmount" DECIMAL(19,4),
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePayment_idempotencyKey_key" ON "InvoicePayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_companyId_date_idx" ON "InvoicePayment"("companyId", "date");

-- CreateIndex
CREATE INDEX "Invoice_companyId_type_paymentStatus_idx" ON "Invoice"("companyId", "type", "paymentStatus");

-- CreateIndex
CREATE INDEX "Invoice_companyId_type_dueDate_idx" ON "Invoice"("companyId", "type", "dueDate");

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_exchangeRateId_fkey" FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
