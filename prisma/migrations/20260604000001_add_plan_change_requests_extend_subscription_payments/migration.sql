-- ADR-032: PlanChangeRequest + extend SubscriptionPayment (txHash, confirmedByUserId, planChangeRequestId)

-- 1. Nuevo enum PlanChangeStatus
CREATE TYPE "PlanChangeStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'APPLYING', 'APPLIED', 'CANCELED');

-- 2. Nueva tabla plan_change_requests
CREATE TABLE "plan_change_requests" (
  "id"                 TEXT NOT NULL,
  "subscriptionId"     TEXT NOT NULL,
  "fromPlan"           "SubscriptionPlan" NOT NULL,
  "toPlan"             "SubscriptionPlan" NOT NULL,
  "newPriceUsdCents"   INTEGER NOT NULL,
  "effectiveDate"      TIMESTAMP(3) NOT NULL,
  "status"             "PlanChangeStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "requestedByUserId"  TEXT NOT NULL,
  "confirmedByUserId"  TEXT,
  "confirmedAt"        TIMESTAMP(3),
  "appliedByUserId"    TEXT,
  "appliedAt"          TIMESTAMP(3),
  "cancelReason"       TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_change_requests_pkey" PRIMARY KEY ("id")
);

-- 3. FK plan_change_requests → subscriptions
ALTER TABLE "plan_change_requests"
  ADD CONSTRAINT "plan_change_requests_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId")
  REFERENCES "subscriptions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Extender subscription_payments con los campos nuevos
ALTER TABLE "subscription_payments"
  ADD COLUMN "planChangeRequestId" TEXT,
  ADD COLUMN "txHash"              TEXT,
  ADD COLUMN "confirmedByUserId"   TEXT;

-- 5. FK subscription_payments → plan_change_requests (nullable)
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_planChangeRequestId_fkey"
  FOREIGN KEY ("planChangeRequestId")
  REFERENCES "plan_change_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Unique en txHash (NULL != NULL en PostgreSQL — no viola unicidad)
CREATE UNIQUE INDEX "subscription_payments_txHash_key"
  ON "subscription_payments"("txHash");

-- 7. Indexes
CREATE INDEX "plan_change_requests_status_effectiveDate_idx"
  ON "plan_change_requests"("status", "effectiveDate");

CREATE INDEX "plan_change_requests_subscriptionId_idx"
  ON "plan_change_requests"("subscriptionId");

CREATE INDEX "subscription_payments_status_createdAt_idx"
  ON "subscription_payments"("status", "createdAt");
