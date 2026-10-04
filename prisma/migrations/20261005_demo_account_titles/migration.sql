-- ADR-059 / SPEC-008: una cuenta de movimiento cuelga de un título padre (A.B.CC.DD de 6 dígitos).
-- Las dos empresas demo de producción ("Empresa Demo C.A." y "Tecnología y Suministros Andina,
-- C.A.") se renumeraron a 9 dígitos (20261005_demo_accounts_nine_digits) pero no tienen títulos.
-- Esta migración crea la jerarquía completa de títulos de cada cuenta de movimiento vigente:
--   nivel 1  A            (ACTIVOS, PASIVOS…)
--   nivel 2  A.B          (grupo, nombre fijo por prefijo)
--   nivel 3  A.B.CC       (nombre = el de la cuenta, en mayúsculas — como en el plan real: "CAJAS"/"CAJAS"/"Caja Principal")
--   nivel 4  A.B.CC.DD    (idem)
-- Todos con isPostable=false. El tipo de un título lo da su primer dígito (1 Activo … 4 Ingreso, 5+ Gasto):
-- una cuenta CONTRA_ASSET cuelga de un título ASSET (SPEC-008 RN-3).
--
-- Una sola sentencia (atómica): si falta el nombre de un grupo de nivel 1 o 2 el `name` queda NULL y
-- toda la migración falla — no hay nombres por defecto silenciosos. Idempotente (ON CONFLICT DO NOTHING
-- sobre @@unique([companyId, code])). Acotada a las dos empresas por id: en una base vacía (CI) no hace nada.
-- Cada título creado deja su fila de AuditLog (R-6).
WITH mov AS (
  SELECT a."companyId", a."code", a."name"
  FROM "Account" a
  WHERE a."companyId" IN ('cmmsh174m0000zsukknyhhzq5', 'cmp5mhzts000060uk2o09ktu1')
    AND a."deletedAt" IS NULL
    AND a."isPostable" = true
    AND a."code" ~ '^[0-9]\.[0-9]\.[0-9]{2}\.[0-9]{2}\.[0-9]{3}$'
),
titulos AS (
  SELECT DISTINCT "companyId", split_part("code", '.', 1) AS code,
         CASE split_part("code", '.', 1)
           WHEN '1' THEN 'ACTIVOS' WHEN '2' THEN 'PASIVOS' WHEN '3' THEN 'PATRIMONIO'
           WHEN '4' THEN 'INGRESOS' WHEN '5' THEN 'COSTOS Y GASTOS' END AS name
  FROM mov
  UNION
  SELECT DISTINCT "companyId", split_part("code", '.', 1) || '.' || split_part("code", '.', 2),
         CASE split_part("code", '.', 1) || '.' || split_part("code", '.', 2)
           WHEN '1.1' THEN 'ACTIVO CIRCULANTE'
           WHEN '1.3' THEN 'CUENTAS POR COBRAR Y ANTICIPOS'
           WHEN '1.5' THEN 'ACTIVO FIJO'
           WHEN '2.1' THEN 'OBLIGACIONES FISCALES'
           WHEN '2.2' THEN 'CUENTAS POR PAGAR Y OBLIGACIONES LABORALES'
           WHEN '3.1' THEN 'CAPITAL'
           WHEN '3.2' THEN 'RESULTADOS ACUMULADOS'
           WHEN '3.3' THEN 'RESULTADO DEL EJERCICIO'
           WHEN '4.1' THEN 'INGRESOS OPERATIVOS'
           WHEN '5.1' THEN 'COSTOS Y GASTOS OPERATIVOS' END
  FROM mov
  UNION
  SELECT "companyId", split_part("code", '.', 1) || '.' || split_part("code", '.', 2) || '.' || split_part("code", '.', 3), upper("name")
  FROM mov
  UNION
  SELECT "companyId", split_part("code", '.', 1) || '.' || split_part("code", '.', 2) || '.' || split_part("code", '.', 3) || '.' || split_part("code", '.', 4), upper("name")
  FROM mov
),
ins AS (
  INSERT INTO "Account" ("id", "companyId", "code", "name", "type", "isPostable", "updatedAt")
  SELECT gen_random_uuid()::text, t."companyId", t.code, t.name,
         (CASE split_part(t.code, '.', 1)
            WHEN '1' THEN 'ASSET' WHEN '2' THEN 'LIABILITY' WHEN '3' THEN 'EQUITY'
            WHEN '4' THEN 'REVENUE' ELSE 'EXPENSE' END)::"AccountType",
         false, now()
  FROM titulos t
  ON CONFLICT ("companyId", "code") DO NOTHING
  RETURNING "id", "companyId", "code", "name", "type"
)
INSERT INTO "AuditLog" ("id", "companyId", "entityId", "entityName", "action", "userId", "newValue", "createdAt")
SELECT gen_random_uuid()::text, i."companyId", i."id", 'Account', 'CREATE',
       'system:migration-20261005_demo_account_titles',
       jsonb_build_object('code', i."code", 'name', i."name", 'type', i."type", 'isPostable', false),
       now()
FROM ins i;
