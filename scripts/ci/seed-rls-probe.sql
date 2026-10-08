-- SPEC-014 D — siembra mínima de la sonda de RLS.
--
-- SOLO para el branch efímero del job `integration` de CI (proyecto de Neon `contaflow-ci`).
-- NUNCA se ejecuta contra un entorno con datos reales: crea empresas de mentira con ids fijos.
--
-- Por qué existe: `scripts/verify-rls-runtime.mjs` es la única prueba conductual de que la
-- RLS aísla (ADR-007 / ADR-044 D-8.3). Para probarla necesita filas de 2+ empresas en alguna
-- tabla tenant, y sale con código 1 si no puede verificar nada, a propósito: un verde sin
-- haber verificado nada es peor que no tener el script. Un branch recién migrado está
-- vacío, así que sin esta siembra el gate estaría siempre en rojo.
--
-- Qué se siembra (mínimo posible, sin tocar la lógica del script):
--   - 2 empresas: solo `id`, `name` y `updatedAt` no tienen valor por defecto en la BD.
--   - 1 fila de `ControlNumberSequence` por empresa (tabla tenant con RLS forzada y
--     columnas obligatorias mínimas: companyId, invoiceType, lastNumber, updatedAt).
--
-- Idempotente (ON CONFLICT DO NOTHING). Se aplica con `prisma db execute`, que conecta con
-- el rol dueño del branch (BYPASSRLS), igual que los tests de integración al sembrar.

-- Guarda técnica (revisión de seguridad de SPEC-014, L-3): `prisma db execute` toma el
-- datasource de prisma.config.ts (DATABASE_URL_DIRECT || DATABASE_URL, y carga .env.local),
-- así que ejecutarlo a mano en una máquina con credenciales reales sembraría empresas falsas en
-- ese entorno. Si la base ya tiene cualquier empresa que no sea de la sonda, se aborta SIN
-- escribir nada. El branch efímero de CI nace vacío, así que ahí nunca se dispara.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Company" WHERE "id" NOT LIKE 'ci-rls-probe-%') THEN
    RAISE EXCEPTION 'seed-rls-probe.sql solo se aplica a un branch efimero de CI vacio: esta base ya tiene empresas reales';
  END IF;
END
$$;

INSERT INTO "Company" ("id", "name", "updatedAt")
VALUES
  ('ci-rls-probe-a', 'CI RLS probe A', NOW()),
  ('ci-rls-probe-b', 'CI RLS probe B', NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ControlNumberSequence" ("id", "companyId", "invoiceType", "lastNumber", "updatedAt")
VALUES
  ('ci-rls-probe-a-sale', 'ci-rls-probe-a', 'SALE', 0, NOW()),
  ('ci-rls-probe-b-sale', 'ci-rls-probe-b', 'SALE', 0, NOW())
ON CONFLICT ("id") DO NOTHING;
