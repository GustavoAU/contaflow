-- Fase 35H: PA-121 — Trazabilidad de red en AuditLog (ADR-019 D-2)
-- Campos nullable: no rompe auditLogs existentes ni requiere backfill

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
