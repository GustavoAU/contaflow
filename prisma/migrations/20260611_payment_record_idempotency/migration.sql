-- ADR-032 F2: idempotencyKey en PaymentRecord — dedupe de doble-submit en la vía
-- canónica de pagos (paridad con InvoicePayment.idempotencyKey).
-- Nullable + UNIQUE: PostgreSQL permite múltiples NULL — los pagos sin key no chocan.

ALTER TABLE "PaymentRecord" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "PaymentRecord_idempotencyKey_key" ON "PaymentRecord"("idempotencyKey");
