-- Fase 23C: NC/ND Workflow — self-relation en Invoice
-- Reglamento IVA Art. 58: vinculación formal NC/ND con factura original
-- onDelete: Restrict (ADR-003) — no se puede eliminar una FACTURA con NCs/NDs hijas
-- ADD COLUMN nullable → 0 filas afectadas, no backfill, rollback seguro

ALTER TABLE "Invoice" ADD COLUMN "relatedInvoiceId" TEXT;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_relatedInvoiceId_fkey"
  FOREIGN KEY ("relatedInvoiceId")
  REFERENCES "Invoice"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "Invoice_relatedInvoiceId_idx" ON "Invoice"("relatedInvoiceId");
