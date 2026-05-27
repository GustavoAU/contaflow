-- FC-02: Campos legales SENIAT en FixedAsset
-- Art. 76 ISLR / Art. 91 Código de Comercio
-- Todos nullable para retrocompatibilidad con activos ya registrados.

ALTER TABLE "FixedAsset"
  ADD COLUMN "invoiceNumber"    TEXT,
  ADD COLUMN "providerRif"      TEXT,
  ADD COLUMN "serialNumber"     TEXT,
  ADD COLUMN "serviceStartDate" DATE,
  ADD COLUMN "internalCode"     TEXT;
