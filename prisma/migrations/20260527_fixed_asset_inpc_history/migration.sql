-- N3: Historial persistente de reajustes INPC por activo fijo
-- Permite auditar cada reajuste de valor por inflación (Art. 173 ISLR)
-- y evitar dobles posteos del mismo período.
CREATE TABLE "FixedAssetINPCRestatement" (
  "id"                TEXT        NOT NULL PRIMARY KEY,
  "companyId"         TEXT        NOT NULL,
  "assetId"           TEXT        NOT NULL,
  "inpcPeriodYear"    INTEGER     NOT NULL,
  "inpcPeriodMonth"   INTEGER     NOT NULL,
  "factor"            DECIMAL(19,10) NOT NULL,
  "adjustmentAmount"  DECIMAL(19,4)  NOT NULL,
  "previousBookValue" DECIMAL(19,4)  NOT NULL,
  "newRestatedValue"  DECIMAL(19,4)  NOT NULL,
  "equityAccountId"   TEXT        NOT NULL,
  "transactionId"     TEXT        NOT NULL,
  "userId"            TEXT        NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixedAssetINPCRestatement_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetINPCRestatement_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Unicidad: un reajuste INPC por activo por período
CREATE UNIQUE INDEX "FixedAssetINPCRestatement_assetId_inpcPeriodYear_inpcPeriodMonth_key"
  ON "FixedAssetINPCRestatement"("assetId", "inpcPeriodYear", "inpcPeriodMonth");

-- Unicidad: un transactionId no puede tener dos reajustes
CREATE UNIQUE INDEX "FixedAssetINPCRestatement_transactionId_key"
  ON "FixedAssetINPCRestatement"("transactionId");

CREATE INDEX "FixedAssetINPCRestatement_companyId_idx"
  ON "FixedAssetINPCRestatement"("companyId");

CREATE INDEX "FixedAssetINPCRestatement_assetId_idx"
  ON "FixedAssetINPCRestatement"("assetId");
