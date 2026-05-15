-- Bloque B Item 3: Contribuyente Especial en ficha de proveedor
-- Determina si aplican retenciones de IVA/ISLR al registrar facturas del proveedor.

ALTER TABLE "Vendor"
  ADD COLUMN "isSpecialContributor" BOOLEAN NOT NULL DEFAULT FALSE;
