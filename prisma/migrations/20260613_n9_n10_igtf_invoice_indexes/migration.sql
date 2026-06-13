-- N9: IGTFTransaction missing companyId index — primary query filter
CREATE INDEX IF NOT EXISTS "IGTFTransaction_companyId_idx"
  ON "IGTFTransaction" ("companyId");

-- N10: Invoice FK columns without dedicated indexes
CREATE INDEX IF NOT EXISTS "Invoice_vendorId_idx"
  ON "Invoice" ("vendorId");

CREATE INDEX IF NOT EXISTS "Invoice_customerId_idx"
  ON "Invoice" ("customerId");

CREATE INDEX IF NOT EXISTS "Invoice_transactionId_idx"
  ON "Invoice" ("transactionId");
