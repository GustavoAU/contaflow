-- Bloque B Item 2: Campos firma Contador Público Colegiado (CPC) en CompanySettings
-- Permite pre-llenar el bloque de firma en reportes financieros (Balance General,
-- Estado de Resultados, Libro Mayor, Balance de Comprobación).

ALTER TABLE "CompanySettings"
  ADD COLUMN "accountantName"      TEXT,
  ADD COLUMN "accountantTitle"     TEXT,
  ADD COLUMN "accountantCpcNumber" TEXT;
