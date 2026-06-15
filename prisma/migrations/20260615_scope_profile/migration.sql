-- ADR-033: ScopeProfile enum + Company.scopeProfile field
-- null = perfil no declarado → onboarding banner en el dashboard

CREATE TYPE "ScopeProfile" AS ENUM ('SOLO', 'EMPRESA', 'DESPACHO');

ALTER TABLE "Company" ADD COLUMN "scopeProfile" "ScopeProfile";
