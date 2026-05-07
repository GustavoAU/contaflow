-- Sprint 3: Suscripciones y Facturación
-- Tablas: subscriptions, subscription_payments

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "SubscriptionPlan" AS ENUM ('TRIAL', 'MONTHLY', 'ANNUAL', 'EARLY_ADOPTER');

CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

CREATE TYPE "BillingPaymentStatus" AS ENUM ('PENDING', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'REFUNDED');

-- ─── subscriptions ────────────────────────────────────────────────────────────

CREATE TABLE "subscriptions" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "plan"                "SubscriptionPlan" NOT NULL,
    "status"              "SubscriptionStatus" NOT NULL,
    "trialEndsAt"         TIMESTAMP(3),
    "currentPeriodStart"  TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd"    TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd"   BOOLEAN NOT NULL DEFAULT false,
    "priceUsdCents"       INTEGER NOT NULL,
    "earlyAdopterSlot"    INTEGER,
    "referredByCompanyId" TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- Unique: una suscripción por empresa
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_key" UNIQUE ("companyId");

-- FK: empresa propietaria
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK: empresa referidora (opcional)
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_referredByCompanyId_fkey"
    FOREIGN KEY ("referredByCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Index: consultas por estado y vencimiento (cron de renovaciones)
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- ─── subscription_payments ────────────────────────────────────────────────────

CREATE TABLE "subscription_payments" (
    "id"                   TEXT NOT NULL,
    "subscriptionId"       TEXT NOT NULL,
    "nowpaymentsOrderId"   TEXT,
    "nowpaymentsPaymentId" TEXT,
    "amountUsdCents"       INTEGER NOT NULL,
    "currency"             TEXT NOT NULL,
    "status"               "BillingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt"               TIMESTAMP(3),
    "metadata"             JSONB,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- Unique: idempotencia NOWPayments
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_nowpaymentsOrderId_key"
    UNIQUE ("nowpaymentsOrderId");

ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_nowpaymentsPaymentId_key"
    UNIQUE ("nowpaymentsPaymentId");

-- FK: suscripción propietaria
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index: pagos por suscripción
CREATE INDEX "subscription_payments_subscriptionId_idx" ON "subscription_payments"("subscriptionId");
