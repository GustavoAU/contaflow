-- 20260813_company_country_format_check
-- ADR-042 D-13 · MEDIUM-1 de la auditoría de seguridad MP-4
--
-- `Company.country` es un String libre: la BD acepta cualquier cadena. Un caller
-- que cruce dos parámetros adyacentes (p.ej. teléfono ↔ país) deja un valor
-- basura en la columna, `isSupportedCountry` falla en el guard de actions y este
-- degrada a VEN EN SILENCIO — la empresa opera con IVA/IGTF/retenciones
-- venezolanas sin que nadie se entere.
--
-- Se valida FORMATO (ISO 3166-1 alpha-3), no MEMBRESÍA. Deliberado:
--   · Un enum Prisma obligaría a una migración por cada país nuevo, rompiendo el
--     "agregar país = agregar archivos" de ADR-042, y sus valores no se pueden
--     eliminar (no existe DROP VALUE).
--   · Además crearía una segunda fuente de verdad frente a FISCAL_CONFIGS: 'COL'
--     válido para la BD pero sin countries/col/ = explosión en getFiscalConfig.
--   · Que 'COL' pase este CHECK antes de existir el provider es CORRECTO: de esa
--     puerta se encarga isSupportedCountry, en la aplicación.
--
-- Pre-flight OBLIGATORIO (debe devolver solo 'VEN'):
--   SELECT country, count(*) FROM "Company" GROUP BY 1;
--
-- Rollback:
--   ALTER TABLE "Company" DROP CONSTRAINT "company_country_iso3166_alpha3";
--
-- Nota: Prisma no expresa CHECK constraints, así que esta regla vive SOLO aquí y
-- en el comentario del campo en schema.prisma — mismo patrón que las policies RLS
-- de ADR-007 A1-bis.

ALTER TABLE "Company"
  ADD CONSTRAINT "company_country_iso3166_alpha3"
  CHECK ("country" ~ '^[A-Z]{3}$');
