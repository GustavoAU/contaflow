-- Fase 22: Ajuste por Inflación Fiscal (INPC / VEN-NIF 3)
-- Migration 1: INPCRate + InflationAdjustment tables

CREATE TABLE "INPCRate" (
    "id"         TEXT         NOT NULL,
    "companyId"  TEXT         NOT NULL,
    "year"       INTEGER      NOT NULL,
    "month"      INTEGER      NOT NULL,
    "indexValue" DECIMAL(18,6) NOT NULL,
    "source"     TEXT         DEFAULT 'BCV',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "INPCRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "INPCRate_company_fk" FOREIGN KEY ("companyId")
        REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "INPCRate_companyId_year_month_key"
    ON "INPCRate"("companyId", "year", "month");

CREATE INDEX "INPCRate_companyId_idx"
    ON "INPCRate"("companyId");

CREATE TABLE "InflationAdjustment" (
    "id"               TEXT          NOT NULL,
    "companyId"        TEXT          NOT NULL,
    "periodYear"       INTEGER       NOT NULL,
    "periodMonth"      INTEGER       NOT NULL,
    "baseYear"         INTEGER       NOT NULL,
    "baseMonth"        INTEGER       NOT NULL,
    "accountId"        TEXT          NOT NULL,
    "originalAmount"   DECIMAL(19,4) NOT NULL,
    "adjustmentAmount" DECIMAL(19,4) NOT NULL,
    "cumulativeIndex"  DECIMAL(18,6) NOT NULL,
    "transactionId"    TEXT          NOT NULL,   -- NON-NULLABLE: VEN-NIF 3
    "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InflationAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InflationAdjustment_company_fk" FOREIGN KEY ("companyId")
        REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InflationAdjustment_account_fk" FOREIGN KEY ("accountId")
        REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InflationAdjustment_transaction_fk" FOREIGN KEY ("transactionId")
        REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InflationAdjustment_companyId_periodYear_periodMonth_accountId_key"
    ON "InflationAdjustment"("companyId", "periodYear", "periodMonth", "accountId");

CREATE INDEX "InflationAdjustment_companyId_periodYear_periodMonth_idx"
    ON "InflationAdjustment"("companyId", "periodYear", "periodMonth");
