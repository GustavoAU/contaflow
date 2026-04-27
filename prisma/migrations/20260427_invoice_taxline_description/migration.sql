-- Fase glosa: agregar campo descripción opcional a InvoiceTaxLine
ALTER TABLE "InvoiceTaxLine" ADD COLUMN "description" TEXT;
