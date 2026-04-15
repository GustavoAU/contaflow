-- Fase 28: Módulo Compras y Ventas

-- Enums
CREATE TYPE "QuotationType" AS ENUM ('PURCHASE', 'SALE');
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONVERTED');
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'CONVERTED', 'CANCELLED');
CREATE TYPE "OrderDocType" AS ENUM ('PURCHASE_QUOTATION', 'SALE_QUOTATION', 'PURCHASE_ORDER', 'SALE_ORDER');

-- OrderNumberSequence
CREATE TABLE "OrderNumberSequence" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "docType"    "OrderDocType" NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderNumberSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderNumberSequence_companyId_docType_key" ON "OrderNumberSequence"("companyId", "docType");
CREATE INDEX "OrderNumberSequence_companyId_idx" ON "OrderNumberSequence"("companyId");
ALTER TABLE "OrderNumberSequence" ADD CONSTRAINT "OrderNumberSequence_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quotation
CREATE TABLE "Quotation" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "type"            "QuotationType" NOT NULL,
  "status"          "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "number"          TEXT NOT NULL,
  "counterpartName" TEXT NOT NULL,
  "counterpartRif"  TEXT,
  "validUntil"      DATE NOT NULL,
  "notes"           TEXT,
  "subtotal"        DECIMAL(19,4) NOT NULL,
  "taxAmount"       DECIMAL(19,4) NOT NULL,
  "total"           DECIMAL(19,4) NOT NULL,
  "currency"        "Currency" NOT NULL DEFAULT 'VES',
  "createdBy"       TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Quotation_companyId_number_type_key" ON "Quotation"("companyId", "number", "type");
CREATE INDEX "Quotation_companyId_type_status_idx" ON "Quotation"("companyId", "type", "status");
CREATE INDEX "Quotation_companyId_createdAt_idx" ON "Quotation"("companyId", "createdAt" DESC);
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- QuotationItem
CREATE TABLE "QuotationItem" (
  "id"          TEXT NOT NULL,
  "quotationId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "unit"        TEXT NOT NULL,
  "quantity"    DECIMAL(19,4) NOT NULL,
  "unitPrice"   DECIMAL(19,4) NOT NULL,
  "taxRate"     DECIMAL(5,2) NOT NULL DEFAULT 0,
  "totalPrice"  DECIMAL(19,4) NOT NULL,
  CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Order
CREATE TABLE "Order" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "type"            "QuotationType" NOT NULL,
  "status"          "OrderStatus" NOT NULL DEFAULT 'DRAFT',
  "number"          TEXT NOT NULL,
  "quotationId"     TEXT,
  "counterpartName" TEXT NOT NULL,
  "counterpartRif"  TEXT,
  "expectedDate"    DATE,
  "notes"           TEXT,
  "subtotal"        DECIMAL(19,4) NOT NULL,
  "taxAmount"       DECIMAL(19,4) NOT NULL,
  "total"           DECIMAL(19,4) NOT NULL,
  "currency"        "Currency" NOT NULL DEFAULT 'VES',
  "createdBy"       TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_quotationId_key" ON "Order"("quotationId");
CREATE UNIQUE INDEX "Order_companyId_number_type_key" ON "Order"("companyId", "number", "type");
CREATE INDEX "Order_companyId_type_status_idx" ON "Order"("companyId", "type", "status");
CREATE INDEX "Order_companyId_createdAt_idx" ON "Order"("companyId", "createdAt" DESC);
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- OrderItem
CREATE TABLE "OrderItem" (
  "id"          TEXT NOT NULL,
  "orderId"     TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "unit"        TEXT NOT NULL,
  "quantity"    DECIMAL(19,4) NOT NULL,
  "unitPrice"   DECIMAL(19,4) NOT NULL,
  "taxRate"     DECIMAL(5,2) NOT NULL DEFAULT 0,
  "totalPrice"  DECIMAL(19,4) NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Link Invoice → Order
ALTER TABLE "Invoice" ADD COLUMN "orderId" TEXT;
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
