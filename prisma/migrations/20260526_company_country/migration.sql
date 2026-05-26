-- Q3-5 Multi-país: campo country en Company (ISO 3166-1 alpha-3)
-- Todas las empresas existentes son venezolanas → default 'VEN'
ALTER TABLE "Company" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'VEN';
