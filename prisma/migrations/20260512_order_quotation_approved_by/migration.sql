-- Add approvedBy and approvedAt audit fields to Order and Quotation
ALTER TABLE "Order" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "Order" ADD COLUMN "approvedAt" TIMESTAMP(3);

ALTER TABLE "Quotation" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "approvedAt" TIMESTAMP(3);
