-- ADR-028: Código de referencia + Grupos en Customer/Vendor

-- CustomerGroup table
CREATE TABLE "CustomerGroup" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- VendorGroup table
CREATE TABLE "VendorGroup" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorGroup_pkey" PRIMARY KEY ("id")
);

-- FK: groups → Company
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorGroup" ADD CONSTRAINT "VendorGroup_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique + index on groups
CREATE UNIQUE INDEX "CustomerGroup_companyId_name_key" ON "CustomerGroup"("companyId", "name");
CREATE UNIQUE INDEX "VendorGroup_companyId_name_key" ON "VendorGroup"("companyId", "name");
CREATE INDEX "CustomerGroup_companyId_idx" ON "CustomerGroup"("companyId");
CREATE INDEX "VendorGroup_companyId_idx" ON "VendorGroup"("companyId");

-- Add code + groupId to Customer
ALTER TABLE "Customer" ADD COLUMN "code"    TEXT;
ALTER TABLE "Customer" ADD COLUMN "groupId" TEXT;

-- Add code + groupId to Vendor
ALTER TABLE "Vendor" ADD COLUMN "code"    TEXT;
ALTER TABLE "Vendor" ADD COLUMN "groupId" TEXT;

-- FK: Customer.groupId → CustomerGroup
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: Vendor.groupId → VendorGroup
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "VendorGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique: one code per company (NULLs are distinct in PostgreSQL, so multiple NULLs are allowed)
CREATE UNIQUE INDEX "Customer_companyId_code_key" ON "Customer"("companyId", "code");
CREATE UNIQUE INDEX "Vendor_companyId_code_key" ON "Vendor"("companyId", "code");
