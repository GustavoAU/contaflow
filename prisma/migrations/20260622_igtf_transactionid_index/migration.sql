-- Migration: 20260622_igtf_transactionid_index
-- N9 (auditoría RUN-2, cierre): índice faltante en la FK IGTFTransaction.transactionId.
-- Sin él, joins por transactionId y el FK-check hacen seq scan. Idempotente.

CREATE INDEX IF NOT EXISTS "IGTFTransaction_transactionId_idx"
  ON "IGTFTransaction" ("transactionId");
