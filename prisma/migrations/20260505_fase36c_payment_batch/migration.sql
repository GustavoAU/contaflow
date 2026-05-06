-- Fase 36C: PaymentBatch — Distribución de Pagos A/P (ADR-022)

CREATE TYPE "PaymentBatchStatus" AS ENUM ('DRAFT', 'APPLIED', 'VOID');

CREATE TABLE "PaymentBatch" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "status"              "PaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "method"              "PaymentMethod" NOT NULL,
    "totalAmountVes"      DECIMAL(19,4) NOT NULL,
    "currency"            TEXT NOT NULL DEFAULT 'VES',
    "totalAmountOriginal" DECIMAL(19,4),
    "exchangeRateId"      TEXT,
    "referenceNumber"     TEXT,
    "originBank"          TEXT,
    "destBank"            TEXT,
    "commissionPct"       DECIMAL(5,2),
    "commissionAmount"    DECIMAL(19,4),
    "totalIgtfAmount"     DECIMAL(19,4),
    "date"                DATE NOT NULL,
    "notes"               TEXT,
    "voidReason"          TEXT,
    "voidedAt"            TIMESTAMP(3),
    "voidedBy"            TEXT,
    "deletedAt"           TIMESTAMP(3),
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy"           TEXT NOT NULL,
    "idempotencyKey"      TEXT NOT NULL,

    CONSTRAINT "PaymentBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentBatchLine" (
    "id"             TEXT NOT NULL,
    "paymentBatchId" TEXT NOT NULL,
    "invoiceId"      TEXT NOT NULL,
    "amountVes"      DECIMAL(19,4) NOT NULL,
    "amountOriginal" DECIMAL(19,4),
    "igtfAmount"     DECIMAL(19,4),
    "notes"          TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentBatchLine_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "PaymentBatch_idempotencyKey_key" ON "PaymentBatch"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentBatchLine_paymentBatchId_invoiceId_key" ON "PaymentBatchLine"("paymentBatchId", "invoiceId");

-- Indexes
CREATE INDEX "PaymentBatch_companyId_idx" ON "PaymentBatch"("companyId");
CREATE INDEX "PaymentBatch_companyId_date_idx" ON "PaymentBatch"("companyId", "date");
CREATE INDEX "PaymentBatch_companyId_status_idx" ON "PaymentBatch"("companyId", "status");
CREATE INDEX "PaymentBatchLine_paymentBatchId_idx" ON "PaymentBatchLine"("paymentBatchId");
CREATE INDEX "PaymentBatchLine_invoiceId_idx" ON "PaymentBatchLine"("invoiceId");

-- BankTransaction: match tipo 4 (conciliación bancaria con PaymentBatch)
ALTER TABLE "BankTransaction" ADD COLUMN "matchedPaymentBatchId" TEXT;
CREATE UNIQUE INDEX "BankTransaction_matchedPaymentBatchId_key" ON "BankTransaction"("matchedPaymentBatchId");

-- Foreign keys
ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentBatch" ADD CONSTRAINT "PaymentBatch_exchangeRateId_fkey"
    FOREIGN KEY ("exchangeRateId") REFERENCES "ExchangeRate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentBatchLine" ADD CONSTRAINT "PaymentBatchLine_paymentBatchId_fkey"
    FOREIGN KEY ("paymentBatchId") REFERENCES "PaymentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentBatchLine" ADD CONSTRAINT "PaymentBatchLine_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_matchedPaymentBatchId_fkey"
    FOREIGN KEY ("matchedPaymentBatchId") REFERENCES "PaymentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
