-- ADR-032 F1: PaymentRecord como entidad canónica de pagos.
-- appliedToInvoice marca los pagos que decrementaron Invoice.pendingAmount al crearse.
-- DEFAULT false es correcto para todos los registros legacy (nunca tocaron saldo):
-- el void de un pago legacy NO debe restaurar un saldo que nunca fue decrementado.

ALTER TABLE "PaymentRecord" ADD COLUMN "appliedToInvoice" BOOLEAN NOT NULL DEFAULT false;
