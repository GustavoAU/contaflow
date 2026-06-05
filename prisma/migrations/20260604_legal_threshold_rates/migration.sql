-- Alícuotas parafiscales configurables desde UI
-- Valores almacenados como porcentaje (ej: 4.00 = 4%, 0.50 = 0.5%)
-- Los cálculos dividen entre 100 para obtener la fracción decimal.

ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'IVSS_OBR_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'IVSS_PAT_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'INCES_OBR_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'INCES_PAT_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'FAOV_OBR_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'FAOV_PAT_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'RPE_OBR_RATE';
ALTER TYPE "LegalThresholdType" ADD VALUE IF NOT EXISTS 'RPE_PAT_RATE';
