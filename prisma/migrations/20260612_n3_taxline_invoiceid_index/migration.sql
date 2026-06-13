-- N3: InvoiceTaxLine missing @@index([invoiceId]) — seq scan on every fiscal report
-- Every invoice lookup (libro compras/ventas, fiscal reports, retenciones) does:
--   WHERE invoiceId = ? on InvoiceTaxLine
-- Without this index, each query scans the full table.

CREATE INDEX IF NOT EXISTS "InvoiceTaxLine_invoiceId_idx"
  ON "InvoiceTaxLine" ("invoiceId");
