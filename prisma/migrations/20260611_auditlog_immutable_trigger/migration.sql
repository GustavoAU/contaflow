-- Migration: 20260611_auditlog_immutable_trigger
-- Fix A6: Triggers BEFORE UPDATE/DELETE en AuditLog — inmutabilidad a nivel DB
--
-- Problema: la tabla AuditLog solo tiene restricción de inmutabilidad a nivel
-- aplicación. Cualquier acceso directo a la BD (psql, herramienta externa,
-- script de mantenimiento) puede alterar o borrar registros de auditoría sin
-- que la aplicación lo detecte, violando los requisitos forenses (PA-121).
--
-- Solución: dos triggers a nivel DB que lanzan EXCEPTION ante cualquier intento
-- de UPDATE o DELETE — incluso si viene de neondb_owner o una conexión directa.

-- ─── Función trigger ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'AuditLog es inmutable (PA-121): no se permiten UPDATE ni DELETE sobre registros de auditoría. Operación: %',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ─── Trigger BEFORE UPDATE ───────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_auditlog_no_update ON "AuditLog";
CREATE TRIGGER trg_auditlog_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ─── Trigger BEFORE DELETE ───────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_auditlog_no_delete ON "AuditLog";
CREATE TRIGGER trg_auditlog_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
