-- Fase 21: Activos Fijos y Depreciación (VEN-NIF 16 / IAS 16)
-- ADR-003: onDelete: Restrict en todas las relaciones contables

-- Enums
CREATE TYPE "DepreciationMethod" AS ENUM ('LINEA_RECTA', 'SUMA_DIGITOS', 'UNIDADES_PRODUCCION');
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED', 'FULLY_DEPRECIATED');

-- FixedAsset
CREATE TABLE "FixedAsset" (
  "id"                       TEXT NOT NULL,
  "companyId"                TEXT NOT NULL,
  "name"                     TEXT NOT NULL,
  "description"              TEXT,
  "assetAccountId"           TEXT NOT NULL,
  "depreciationAccountId"    TEXT NOT NULL,
  "accDepreciationAccountId" TEXT NOT NULL,
  "acquisitionDate"          DATE NOT NULL,
  "acquisitionCost"          DECIMAL(19,4) NOT NULL,
  "residualValue"            DECIMAL(19,4) NOT NULL DEFAULT 0,
  "usefulLifeMonths"         INTEGER NOT NULL,
  "depreciationMethod"       "DepreciationMethod" NOT NULL DEFAULT 'LINEA_RECTA',
  "status"                   "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
  "totalUnits"               INTEGER,
  "unitsUsed"                INTEGER NOT NULL DEFAULT 0,
  "deletedAt"                TIMESTAMP(3),
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"                TEXT NOT NULL,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FixedAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_depreciationAccountId_fkey" FOREIGN KEY ("depreciationAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_accDepreciationAccountId_fkey" FOREIGN KEY ("accDepreciationAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "FixedAsset_companyId_idx" ON "FixedAsset"("companyId");
CREATE INDEX "FixedAsset_companyId_status_idx" ON "FixedAsset"("companyId", "status");

-- DepreciationEntry
CREATE TABLE "DepreciationEntry" (
  "id"                      TEXT NOT NULL,
  "companyId"               TEXT NOT NULL,
  "fixedAssetId"            TEXT NOT NULL,
  "periodYear"              INTEGER NOT NULL,
  "periodMonth"             INTEGER NOT NULL,
  "amount"                  DECIMAL(19,4) NOT NULL,
  "accumulatedDepreciation" DECIMAL(19,4) NOT NULL,
  "bookValue"               DECIMAL(19,4) NOT NULL,
  "transactionId"           TEXT,
  "postedAt"                TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepreciationEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DepreciationEntry_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "FixedAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DepreciationEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DepreciationEntry_transactionId_key" ON "DepreciationEntry"("transactionId") WHERE "transactionId" IS NOT NULL;
CREATE UNIQUE INDEX "DepreciationEntry_fixedAssetId_periodYear_periodMonth_key" ON "DepreciationEntry"("fixedAssetId", "periodYear", "periodMonth");
CREATE INDEX "DepreciationEntry_companyId_periodYear_periodMonth_idx" ON "DepreciationEntry"("companyId", "periodYear", "periodMonth");
