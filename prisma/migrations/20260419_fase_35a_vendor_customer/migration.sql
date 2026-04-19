-- Fase 35A: Vendor / Customer con FK nullable en Invoice
-- (ADR-003: soft-delete via deletedAt; ADR-004: companyId siempre presente)

-- CreateTable Vendor
CREATE TABLE "Vendor" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "rif"       TEXT,
    "email"     TEXT,
    "phone"     TEXT,
    "address"   TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable Customer
CREATE TABLE "Customer" (
    "id"        TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "rif"       TEXT,
    "email"     TEXT,
    "phone"     TEXT,
    "address"   TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- AddColumn vendorId / customerId en Invoice (nullable — FK opcional, strings libres se preservan)
ALTER TABLE "Invoice" ADD COLUMN "vendorId"   TEXT;
ALTER TABLE "Invoice" ADD COLUMN "customerId" TEXT;

-- Partial unique index: rif único por empresa (NULLs no violan la constraint en PostgreSQL)
CREATE UNIQUE INDEX "Vendor_companyId_rif_key"   ON "Vendor"("companyId", "rif") WHERE "rif" IS NOT NULL;
CREATE UNIQUE INDEX "Customer_companyId_rif_key" ON "Customer"("companyId", "rif") WHERE "rif" IS NOT NULL;

-- Índices operacionales
CREATE INDEX "Vendor_companyId_deletedAt_idx"   ON "Vendor"("companyId", "deletedAt");
CREATE INDEX "Customer_companyId_deletedAt_idx" ON "Customer"("companyId", "deletedAt");
CREATE INDEX "Invoice_vendorId_idx"             ON "Invoice"("vendorId")   WHERE "vendorId"   IS NOT NULL;
CREATE INDEX "Invoice_customerId_idx"           ON "Invoice"("customerId") WHERE "customerId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "Vendor"   ADD CONSTRAINT "Vendor_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"  ADD CONSTRAINT "Invoice_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"  ADD CONSTRAINT "Invoice_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
