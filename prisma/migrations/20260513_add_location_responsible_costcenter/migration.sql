-- Ítem 40: location + responsible en FixedAsset
ALTER TABLE "FixedAsset" ADD COLUMN "location"    TEXT;
ALTER TABLE "FixedAsset" ADD COLUMN "responsible" TEXT;

-- Ítem 52: costCenter en Employee
ALTER TABLE "Employee" ADD COLUMN "costCenter" TEXT;
