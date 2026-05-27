-- N2: Moneda de adquisición y tasa BCV histórica en Activos Fijos
-- Permite registrar el costo original en moneda extranjera (USD/EUR)
-- y la tasa BCV vigente a la fecha de adquisición.
ALTER TABLE "FixedAsset"
  ADD COLUMN "acquisitionCurrency"   "Currency"     NOT NULL DEFAULT 'VES',
  ADD COLUMN "bcvRateAtAcquisition"  DECIMAL(19, 4);
