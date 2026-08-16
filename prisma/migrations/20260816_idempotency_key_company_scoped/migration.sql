-- 20260816_idempotency_key_company_scoped
-- ADR-004 · §10 M-3 de la auditoría de seguridad de ADR-044
--
-- QUÉ ARREGLA
-- `idempotencyKey` era `@unique` GLOBAL en 10 modelos que TODOS tienen `companyId`.
-- Eso producía dos defectos distintos:
--
--   (a) IDOR. El constraint global invita al lookup global. Tres servicios hacían
--       `findUnique({ where: { idempotencyKey } })` y DEVOLVÍAN la fila: la empresa
--       B recibía el gasto / el movimiento de inventario de A. En Expense e
--       InventoryMovement la clave la suministra el CLIENTE (`z.string().uuid()`),
--       así que era adivinable/reproducible, no sólo teórica.
--
--   (b) Denegación de servicio cross-tenant. Aunque el lookup esté acotado, el
--       CONSTRAINT no lo estaba: si A usaba la clave K, B veía "no existe" al
--       buscar, intentaba crear y se llevaba un P2002 por una fila que no puede
--       ver. B quedaba bloqueada sin explicación posible. Con UUIDv4 la
--       probabilidad es despreciable; con un cliente roto o una integración con
--       UUID no aleatorio (v5/determinista) es certeza.
--
-- La idempotencia SIEMPRE fue un concepto por empresa. El constraint decía otra cosa.
--
-- Se incluye `income_distributions.referenceNumber`, mismo patrón y bug LATENTE hoy:
-- el correlativo se calcula por empresa (`count({where:{companyId}})` → DIST-000000)
-- contra un `@unique` GLOBAL → la primera distribución de la SEGUNDA empresa choca
-- en P2002 de forma PERMANENTE. (El `count` como base del correlativo es un defecto
-- aparte — Z-1 — y NO se arregla aquí: ver el informe de la decisión.)
--
-- POR QUÉ NO PUEDE FALLAR HACIA ADELANTE
-- El índice compuesto (companyId, col) es ESTRICTAMENTE MÁS DÉBIL que el global
-- (col): cualquier par de filas que colisione bajo el compuesto colisionaría
-- también bajo el global, que ya está vigente. Por construcción no existen datos
-- que violen el nuevo índice → el CREATE no puede fallar, y ningún INSERT que hoy
-- funciona empieza a fallar. Por eso esta migración puede ir a la BD ANTES que el
-- código sin abrir ninguna ventana de riesgo.
--
-- NULLs: se preserva el comportamiento actual. Invoice, PaymentRecord e
-- IncomeDistribution tienen la clave nullable; PostgreSQL indexa con NULLS
-- DISTINCT por defecto, así que (companyId, NULL) nunca colisiona con
-- (companyId, NULL). Igual que hoy con el índice de una sola columna. NO se usa
-- NULLS NOT DISTINCT.
--
-- POR QUÉ UN DO BLOCK Y NO 20 DDL SUELTAS
--   1. Las migraciones de este repo se escriben a mano (`prisma migrate dev` está
--      ROTO), así que el nombre real del objeto viejo NO está garantizado por la
--      convención de Prisma. Se descubre en el catálogo en vez de adivinarse.
--   2. Un `@unique` puede materializarse como CONSTRAINT (si la columna existía al
--      CREATE TABLE) o como ÍNDICE suelto (si se añadió por ALTER TABLE). `DROP
--      INDEX` falla sobre el primero y `DROP CONSTRAINT` sobre el segundo. Aquí se
--      distingue.
--   3. Es UNA sola sentencia: atómica, y aplicable en una única llamada del driver
--      `neon()` por HTTP 443 cuando la VPN bloquea el 5432.
--   4. Es idempotente: re-ejecutarla no hace daño.
--
-- Los índices NUEVOS sí llevan el nombre exacto que Prisma genera por defecto
-- (`<tabla>_companyId_<col>_key`, sobre el nombre MAPEADO de la tabla) para que no
-- haya drift contra `@@unique([companyId, …])` en schema.prisma.
--
-- PRE-FLIGHT (informativo — inventario de los objetos que se van a tocar):
--   SELECT rel.relname AS tabla, i.relname AS indice, x.indisunique, x.indnkeyatts
--     FROM pg_index x
--     JOIN pg_class i   ON i.oid = x.indexrelid
--     JOIN pg_class rel ON rel.oid = x.indrelid
--    WHERE rel.relname IN ('Retencion','Invoice','PaymentRecord','InvoicePayment',
--                          'InventoryMovement','PaymentBatch','PayrollRun',
--                          'Termination','Expense','income_distributions')
--      AND x.indisunique
--    ORDER BY 1,2;
--
-- ROLLBACK — NO es incondicional. Restaurar el `@unique` global exige que en el
-- ínterin no haya entrado la misma clave en dos empresas. Comprobar PRIMERO:
--   SELECT "idempotencyKey", count(*) FROM "Expense"
--    WHERE "idempotencyKey" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;   -- y análogas
-- Si sale vacío para las 11 combinaciones, revertir con:
--   ALTER TABLE "Expense" ADD CONSTRAINT "Expense_idempotencyKey_key" UNIQUE ("idempotencyKey");
--   DROP INDEX "Expense_companyId_idempotencyKey_key";
--   -- (ídem para las otras 10; en income_distributions la tabla va sin comillas mayúsculas)
-- Si NO sale vacío, el rollback es imposible sin borrar datos: revertir sólo el
-- código (que sigue siendo correcto contra el índice compuesto) y dejar el schema.

DO $$
DECLARE
  spec         record;
  new_ix       text;
  old_name     text;
  dropped      int := 0;
  created      int := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Retencion',            'idempotencyKey'),
      ('Invoice',              'idempotencyKey'),
      ('PaymentRecord',        'idempotencyKey'),
      ('InvoicePayment',       'idempotencyKey'),
      ('InventoryMovement',    'idempotencyKey'),
      ('PaymentBatch',         'idempotencyKey'),
      ('PayrollRun',           'idempotencyKey'),
      ('Termination',          'idempotencyKey'),
      ('Expense',              'idempotencyKey'),
      ('income_distributions', 'idempotencyKey'),
      ('income_distributions', 'referenceNumber')
    ) AS t(tbl, col)
  LOOP
    -- La tabla debe existir; si no, es que el schema no es el que creemos → abortar.
    IF to_regclass(quote_ident(spec.tbl)) IS NULL THEN
      RAISE EXCEPTION 'Tabla % no existe en el schema %', spec.tbl, current_schema();
    END IF;

    new_ix := spec.tbl || '_companyId_' || spec.col || '_key';

    -- ── 1) Crear el índice compuesto ANTES de soltar el global ────────────────
    -- Nunca hay una ventana sin unicidad. No puede fallar (ver cabecera).
    IF to_regclass(quote_ident(new_ix)) IS NULL THEN
      EXECUTE format(
        'CREATE UNIQUE INDEX %I ON %I ("companyId", %I)',
        new_ix, spec.tbl, spec.col
      );
      created := created + 1;
      RAISE NOTICE 'CREADO  %', new_ix;
    END IF;

    -- ── 2) Soltar el unique GLOBAL de una sola columna ────────────────────────
    -- Caso A: es un CONSTRAINT (columna presente en el CREATE TABLE original).
    SELECT c.conname INTO old_name
      FROM pg_constraint c
      JOIN pg_class     rel ON rel.oid = c.conrelid
      JOIN pg_namespace n   ON n.oid   = rel.relnamespace
     WHERE n.nspname   = current_schema()
       AND rel.relname = spec.tbl
       AND c.contype   = 'u'
       AND (
             -- `attname` es `name`, no `text`: sin el cast Postgres falla con
             -- "operator does not exist: name[] = text[]".
             SELECT array_agg(a.attname::text ORDER BY a.attnum)
               FROM unnest(c.conkey) AS k(attnum)
               JOIN pg_attribute a
                 ON a.attrelid = c.conrelid AND a.attnum = k.attnum
           ) = ARRAY[spec.col]
     LIMIT 1;

    IF old_name IS NOT NULL THEN
      -- Sin CASCADE a propósito: si algo dependiera de este unique (una FK que lo
      -- referenciara), queremos enterarnos con un error, no arrastrarlo en silencio.
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', spec.tbl, old_name);
      dropped := dropped + 1;
      RAISE NOTICE 'SOLTADO constraint % (tabla %)', old_name, spec.tbl;
      old_name := NULL;
      CONTINUE;
    END IF;

    -- Caso B: es un ÍNDICE único suelto (columna añadida por ALTER TABLE).
    SELECT i.relname INTO old_name
      FROM pg_index     x
      JOIN pg_class     i   ON i.oid   = x.indexrelid
      JOIN pg_class     rel ON rel.oid = x.indrelid
      JOIN pg_namespace n   ON n.oid   = rel.relnamespace
     WHERE n.nspname      = current_schema()
       AND rel.relname    = spec.tbl
       AND x.indisunique
       AND NOT x.indisprimary
       AND x.indnkeyatts  = 1          -- excluye el compuesto recién creado
       AND x.indpred     IS NULL       -- no tocar los unique PARCIALES (Fix A3, ADR-035)
       AND x.indexprs    IS NULL
       AND (
             SELECT a.attname
               FROM pg_attribute a
              WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
           ) = spec.col
     LIMIT 1;

    IF old_name IS NOT NULL THEN
      EXECUTE format('DROP INDEX %I', old_name);
      dropped := dropped + 1;
      RAISE NOTICE 'SOLTADO indice % (tabla %)', old_name, spec.tbl;
      old_name := NULL;
    ELSE
      RAISE NOTICE 'SIN unique global sobre %.% (ya migrado)', spec.tbl, spec.col;
    END IF;
  END LOOP;

  RAISE NOTICE 'Resumen: % indices compuestos creados, % uniques globales soltados', created, dropped;

  -- ── 3) Verificación: nada de esto se da por hecho ──────────────────────────
  -- Si algún unique global sobrevivió, o falta algún compuesto, se lanza y el DO
  -- entero revierte. Una migración a medias en un constraint de unicidad es peor
  -- que no haberla corrido.
  FOR spec IN
    SELECT * FROM (VALUES
      ('Retencion',            'idempotencyKey'),
      ('Invoice',              'idempotencyKey'),
      ('PaymentRecord',        'idempotencyKey'),
      ('InvoicePayment',       'idempotencyKey'),
      ('InventoryMovement',    'idempotencyKey'),
      ('PaymentBatch',         'idempotencyKey'),
      ('PayrollRun',           'idempotencyKey'),
      ('Termination',          'idempotencyKey'),
      ('Expense',              'idempotencyKey'),
      ('income_distributions', 'idempotencyKey'),
      ('income_distributions', 'referenceNumber')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass(quote_ident(spec.tbl || '_companyId_' || spec.col || '_key')) IS NULL THEN
      RAISE EXCEPTION 'FALTA el indice compuesto %_companyId_%_key', spec.tbl, spec.col;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_index     x
        JOIN pg_class     rel ON rel.oid = x.indrelid
        JOIN pg_namespace n   ON n.oid   = rel.relnamespace
       WHERE n.nspname     = current_schema()
         AND rel.relname   = spec.tbl
         AND x.indisunique
         AND NOT x.indisprimary
         AND x.indnkeyatts = 1
         AND x.indpred    IS NULL
         AND x.indexprs   IS NULL
         AND (
               SELECT a.attname
                 FROM pg_attribute a
                WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
             ) = spec.col
    ) THEN
      RAISE EXCEPTION 'SOBREVIVE un unique GLOBAL sobre %.% — abortando', spec.tbl, spec.col;
    END IF;
  END LOOP;
END $$;
