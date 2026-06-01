-- Migration: 20260531_invoice_counterpart_snapshot
-- H-1: dirección fiscal del contribuyente (Art. 57 Ley IVA + Art. 13 Prov. 00071)
-- H-2: metadato de contribuyente especial (Prov. 0049) en registro histórico de factura

ALTER TABLE "Invoice" ADD COLUMN "counterpartAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "counterpartIsSpecialContributor" BOOLEAN NOT NULL DEFAULT false;
