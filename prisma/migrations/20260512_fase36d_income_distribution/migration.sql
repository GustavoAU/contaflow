-- Fase 36D: IncomeDistribution — Distribución de Ingresos Multidestinatario (ADR-023)

CREATE TYPE "IncomeDistributionStatus" AS ENUM ('DRAFT', 'APPLIED', 'VOID');

CREATE TABLE "income_distributions" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "referenceNumber"     VARCHAR(50),
    "description"         TEXT,
    "date"                DATE NOT NULL,
    "status"              "IncomeDistributionStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode"        VARCHAR(3) NOT NULL DEFAULT 'VES',
    "totalAmountOriginal" DECIMAL(18, 2) NOT NULL,
    "totalAmountVes"      DECIMAL(18, 2) NOT NULL,
    "exchangeRate"        DECIMAL(8, 6) NOT NULL DEFAULT 1,
    "originAccountId"     TEXT NOT NULL,
    "transactionId"       TEXT,
    "idempotencyKey"      VARCHAR(255),
    "voidReason"          TEXT,
    "voidedAt"            TIMESTAMP(3),
    "voidedBy"            VARCHAR(255),
    "deletedAt"           TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    "createdBy"           VARCHAR(255) NOT NULL,

    CONSTRAINT "income_distributions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "income_distribution_lines" (
    "id"                 TEXT NOT NULL,
    "distributionId"     TEXT NOT NULL,
    "recipientCompanyId" TEXT NOT NULL,
    "accountId"          TEXT NOT NULL,
    "percentageShare"    DECIMAL(5, 2) NOT NULL,
    "amountVes"          DECIMAL(18, 2) NOT NULL,
    "lineDescription"    TEXT,
    "lineNumber"         INTEGER NOT NULL,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_distribution_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "income_distribution_audits" (
    "id"             TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "action"         VARCHAR(50) NOT NULL,
    "changesSummary" JSONB,
    "userId"         VARCHAR(255) NOT NULL,
    "ipAddress"      VARCHAR(45),
    "userAgent"      TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_distribution_audits_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "income_distributions_referenceNumber_key"
    ON "income_distributions"("referenceNumber");
CREATE UNIQUE INDEX "income_distributions_transactionId_key"
    ON "income_distributions"("transactionId");
CREATE UNIQUE INDEX "income_distributions_idempotencyKey_key"
    ON "income_distributions"("idempotencyKey");
CREATE UNIQUE INDEX "income_distribution_lines_distributionId_recipientCompanyId_key"
    ON "income_distribution_lines"("distributionId", "recipientCompanyId");

-- Indexes
CREATE INDEX "income_distributions_companyId_status_idx"
    ON "income_distributions"("companyId", "status");
CREATE INDEX "income_distributions_companyId_date_idx"
    ON "income_distributions"("companyId", "date");
CREATE INDEX "income_distribution_lines_distributionId_idx"
    ON "income_distribution_lines"("distributionId");
CREATE INDEX "income_distribution_audits_distributionId_idx"
    ON "income_distribution_audits"("distributionId");

-- Foreign keys
ALTER TABLE "income_distributions"
    ADD CONSTRAINT "income_distributions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distributions"
    ADD CONSTRAINT "income_distributions_originAccountId_fkey"
    FOREIGN KEY ("originAccountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distributions"
    ADD CONSTRAINT "income_distributions_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distribution_lines"
    ADD CONSTRAINT "income_distribution_lines_distributionId_fkey"
    FOREIGN KEY ("distributionId") REFERENCES "income_distributions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distribution_lines"
    ADD CONSTRAINT "income_distribution_lines_recipientCompanyId_fkey"
    FOREIGN KEY ("recipientCompanyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distribution_lines"
    ADD CONSTRAINT "income_distribution_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "income_distribution_audits"
    ADD CONSTRAINT "income_distribution_audits_distributionId_fkey"
    FOREIGN KEY ("distributionId") REFERENCES "income_distributions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
