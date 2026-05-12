-- Fase 35D: Caja Chica (Fondo Fijo)
-- Creates 4 enums + 4 tables

-- Enums
CREATE TYPE "CajaCajaStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');
CREATE TYPE "CajaCajaDepositStatus" AS ENUM ('PENDING', 'POSTED', 'VOIDED');
CREATE TYPE "CajaCajaMovementStatus" AS ENUM ('PENDING', 'APPROVED', 'REIMBURSED', 'VOIDED');
CREATE TYPE "CajaCajaReimbursementStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CajaCaja
CREATE TABLE "caja_cajas" (
  "id"         TEXT          NOT NULL,
  "companyId"  TEXT          NOT NULL,
  "name"       VARCHAR(255)  NOT NULL,
  "accountId"  TEXT          NOT NULL,
  "currency"   "Currency"    NOT NULL DEFAULT 'VES',
  "maxBalance" DECIMAL(19,4) NOT NULL,
  "status"     "CajaCajaStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"  VARCHAR(255)  NOT NULL,
  "closedAt"   TIMESTAMP(3),
  "closedBy"   VARCHAR(255),

  CONSTRAINT "caja_cajas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caja_cajas_companyId_accountId_key" ON "caja_cajas"("companyId", "accountId");
CREATE INDEX "caja_cajas_companyId_status_idx" ON "caja_cajas"("companyId", "status");

ALTER TABLE "caja_cajas"
  ADD CONSTRAINT "caja_cajas_companyId_fkey"  FOREIGN KEY ("companyId")  REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "caja_cajas_accountId_fkey"  FOREIGN KEY ("accountId")  REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CajaCajaDeposit
CREATE TABLE "caja_caja_deposits" (
  "id"                   TEXT                   NOT NULL,
  "companyId"            TEXT                   NOT NULL,
  "cajaCajaId"           TEXT                   NOT NULL,
  "date"                 DATE                   NOT NULL,
  "amount"               DECIMAL(19,4)          NOT NULL,
  "description"          VARCHAR(500)           NOT NULL,
  "supportingDocumentId" VARCHAR(255),
  "transactionId"        TEXT,
  "status"               "CajaCajaDepositStatus" NOT NULL DEFAULT 'PENDING',
  "voidedAt"             TIMESTAMP(3),
  "voidReason"           TEXT,
  "createdAt"            TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"            VARCHAR(255)           NOT NULL,

  CONSTRAINT "caja_caja_deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caja_caja_deposits_transactionId_key" ON "caja_caja_deposits"("transactionId");
CREATE INDEX "caja_caja_deposits_companyId_cajaCajaId_idx" ON "caja_caja_deposits"("companyId", "cajaCajaId");

ALTER TABLE "caja_caja_deposits"
  ADD CONSTRAINT "caja_caja_deposits_cajaCajaId_fkey"    FOREIGN KEY ("cajaCajaId")    REFERENCES "caja_cajas"("id")   ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "caja_caja_deposits_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CajaCajaReimbursement (must be before CajaCajaMovement due to FK)
CREATE TABLE "caja_caja_reimbursements" (
  "id"                  TEXT                           NOT NULL,
  "companyId"           TEXT                           NOT NULL,
  "cajaCajaId"          TEXT                           NOT NULL,
  "monthYear"           VARCHAR(7)                     NOT NULL,
  "reimbursementNumber" VARCHAR(50)                    NOT NULL,
  "totalExpensesVes"    DECIMAL(19,4)                  NOT NULL,
  "transactionId"       TEXT,
  "status"              "CajaCajaReimbursementStatus"  NOT NULL DEFAULT 'DRAFT',
  "postedAt"            TIMESTAMP(3),
  "postedBy"            VARCHAR(255),
  "voidedAt"            TIMESTAMP(3),
  "voidReason"          TEXT,
  "createdAt"           TIMESTAMP(3)                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"           VARCHAR(255)                   NOT NULL,

  CONSTRAINT "caja_caja_reimbursements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caja_caja_reimbursements_transactionId_key"           ON "caja_caja_reimbursements"("transactionId");
CREATE UNIQUE INDEX "caja_caja_reimbursements_reimbursementNumber_key"     ON "caja_caja_reimbursements"("companyId", "reimbursementNumber");
CREATE UNIQUE INDEX "caja_caja_reimbursements_companyId_cajaCajaId_month"  ON "caja_caja_reimbursements"("companyId", "cajaCajaId", "monthYear");
CREATE INDEX        "caja_caja_reimbursements_companyId_cajaCajaId_idx"    ON "caja_caja_reimbursements"("companyId", "cajaCajaId");

ALTER TABLE "caja_caja_reimbursements"
  ADD CONSTRAINT "caja_caja_reimbursements_cajaCajaId_fkey"    FOREIGN KEY ("cajaCajaId")    REFERENCES "caja_cajas"("id")   ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "caja_caja_reimbursements_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CajaCajaMovement
CREATE TABLE "caja_caja_movements" (
  "id"                   TEXT                     NOT NULL,
  "companyId"            TEXT                     NOT NULL,
  "cajaCajaId"           TEXT                     NOT NULL,
  "date"                 DATE                     NOT NULL,
  "voucherNumber"        VARCHAR(50)              NOT NULL,
  "concept"              VARCHAR(255)             NOT NULL,
  "description"          TEXT,
  "expenseAccountId"     TEXT                     NOT NULL,
  "amount"               DECIMAL(19,4)            NOT NULL,
  "currency"             "Currency"               NOT NULL DEFAULT 'VES',
  "supportingDocumentId" VARCHAR(255),
  "notes"                TEXT,
  "status"               "CajaCajaMovementStatus" NOT NULL DEFAULT 'PENDING',
  "approvedAt"           TIMESTAMP(3),
  "approvedBy"           VARCHAR(255),
  "reimbursementId"      TEXT,
  "voidedAt"             TIMESTAMP(3),
  "voidReason"           TEXT,
  "createdAt"            TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"            VARCHAR(255)             NOT NULL,

  CONSTRAINT "caja_caja_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caja_caja_movements_companyId_voucherNumber_key" ON "caja_caja_movements"("companyId", "voucherNumber");
CREATE INDEX "caja_caja_movements_companyId_cajaCajaId_idx" ON "caja_caja_movements"("companyId", "cajaCajaId");
CREATE INDEX "caja_caja_movements_status_date_idx"          ON "caja_caja_movements"("status", "date");

ALTER TABLE "caja_caja_movements"
  ADD CONSTRAINT "caja_caja_movements_cajaCajaId_fkey"       FOREIGN KEY ("cajaCajaId")       REFERENCES "caja_cajas"("id")               ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "caja_caja_movements_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id")                  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "caja_caja_movements_reimbursementId_fkey"  FOREIGN KEY ("reimbursementId")  REFERENCES "caja_caja_reimbursements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
