-- M7: Índice compuesto Invoice(companyId, periodId, type) para consultas de libro fiscal por período
-- Aplicar en Neon SQL Editor (TCP 5432 bloqueado por VPN — usar HTTPS/443)

CREATE INDEX IF NOT EXISTS "Invoice_companyId_periodId_type_idx"
ON "Invoice" ("companyId", "periodId", "type");
