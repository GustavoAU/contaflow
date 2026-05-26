-- Migration: 20260525_payments_phone_void
-- Adds senderPhone, destPhone (PagoMóvil trazabilidad bancaria #1/#16)
-- and deletedAt, voidReason (anulación de PaymentRecord #14)

ALTER TABLE "PaymentRecord" ADD COLUMN "senderPhone" TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN "destPhone"   TEXT;
ALTER TABLE "PaymentRecord" ADD COLUMN "deletedAt"   TIMESTAMP(3);
ALTER TABLE "PaymentRecord" ADD COLUMN "voidReason"  TEXT;
