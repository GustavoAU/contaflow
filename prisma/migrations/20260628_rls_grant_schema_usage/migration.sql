-- Migration: 20260628_rls_grant_schema_usage
-- ADR-007 addendum — Fix A1-ter: GRANT USAGE ON SCHEMA public TO authenticated
--
-- Bug (HA-01, auditoría módulo Pagos): al registrar un pago (o crear/editar una
-- cuenta) el servidor devolvía "permission denied for schema public".
--
-- Causa raíz: withCompanyContext hace `SET LOCAL ROLE authenticated` para
-- neutralizar el BYPASSRLS de neondb_owner. Las migraciones previas
-- (20260406110000_fase13d_rls_company_isolation y 20260611_rls_force_with_check)
-- otorgaron a `authenticated` privilegios sobre TABLAS y SECUENCIAS, pero NUNCA
-- `USAGE ON SCHEMA public`. En Postgres, acceder a una tabla exige USAGE sobre el
-- schema que la contiene ADEMÁS del privilegio de tabla. En Neon el schema public
-- no concede USAGE a PUBLIC por defecto, así que tras el SET ROLE cualquier query
-- sobre una tabla fallaba con "permission denied for schema public".
--
-- Esto afectaba a TODO call-site de withCompanyContext (createPaymentAction,
-- createAccountAction, updateAccountAction), no solo a Pagos.
--
-- Fix: conceder USAGE sobre el schema. USAGE a nivel de schema es permanente y
-- cubre también las tablas futuras (no depende de ALTER DEFAULT PRIVILEGES, que
-- aplica a objetos, no al schema). GRANT es idempotente: re-ejecutarlo es no-op.
--
-- Depende de: 20260611_rls_force_with_check

-- Pieza faltante (causa raíz de HA-01):
GRANT USAGE ON SCHEMA public TO authenticated;

-- Defensa (validado por arch-agent): los GRANT `ON ALL TABLES/SEQUENCES` son
-- snapshots del momento de ejecución y los ALTER DEFAULT PRIVILEGES solo cubren
-- objetos creados por el mismo rol tras 2026-06-11. Re-capturamos cualquier
-- tabla/secuencia creada entre 20260611 y hoy que no haya heredado los grants.
-- Idempotente. NO se concede CREATE ON SCHEMA (mantiene la superficie mínima).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
