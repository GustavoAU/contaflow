-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO', 'REPORTE_Z', 'RESUMEN_VENTAS', 'PLANILLA_IMPORTACION', 'OTRO');

-- CreateEnum
CREATE TYPE "TaxCategory" AS ENUM ('GRAVADA', 'EXENTA', 'EXONERADA', 'NO_SUJETA', 'IMPORTACION');

-- CreateEnum
CREATE TYPE "TaxLineType" AS ENUM ('IVA_GENERAL', 'IVA_REDUCIDO', 'IVA_ADICIONAL', 'EXENTO');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "docType" "InvoiceDocType" NOT NULL DEFAULT 'FACTURA',
    "taxCategory" "TaxCategory" NOT NULL DEFAULT 'GRAVADA',
    "invoiceNumber" TEXT NOT NULL,
    "controlNumber" TEXT,
    "relatedDocNumber" TEXT,
    "importFormNumber" TEXT,
    "reportZStart" TEXT,
    "reportZEnd" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "counterpartName" TEXT NOT NULL,
    "counterpartRif" TEXT NOT NULL,
    "ivaRetentionAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "ivaRetentionVoucher" TEXT,
    "ivaRetentionDate" TIMESTAMP(3),
    "islrRetentionAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "igtfBase" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "igtfAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "transactionId" TEXT,
    "periodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTaxLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "taxType" "TaxLineType" NOT NULL,
    "base" DECIMAL(19,4) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "InvoiceTaxLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_companyId_type_date_idx" ON "Invoice"("companyId", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_invoiceNumber_type_key" ON "Invoice"("companyId", "invoiceNumber", "type");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceTaxLine" ADD CONSTRAINT "InvoiceTaxLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
