-- 20260816_retention_sequence_drop_orphan_unique
-- Z-1 (correlativo fiscal) · Providencia 0049 Art. 11
--
-- BUG DE PRODUCCIÓN ACTIVO — no latente. Las retenciones llevan sin poder
-- emitirse desde julio de 2026.
--
-- QUÉ PASA
-- `RetentionSequence` tiene en la BD un `UNIQUE ("companyId")` que `schema.prisma`
-- NO declara. Eso limita la tabla a UNA FILA POR EMPRESA, mientras el código
-- (`RetentionService.getNextVoucherNumber`) hace:
--
--     upsert({ where: { companyId_year_month: { companyId, year, month } },
--              create: { companyId, year, month, lastNumber: 1 }, … })
--
-- Al primer comprobante de un MES NUEVO el `where` no encuentra fila → rama
-- `create` → viola el único global → P2002. La empresa no puede emitir NINGÚN
-- comprobante de retención en ningún mes distinto al que ya tiene fila, y el
-- usuario sólo ve un mensaje genérico (`toActionError`) sin pista del motivo.
--
-- Estado al escribir esto: la tabla tenía 1 fila, `2026/06`. Estamos en agosto.
--
-- POR QUÉ SOBREVIVIÓ (la parte que hay que recordar)
--   · 20260330021018 lo creó como  CREATE UNIQUE INDEX "RetentionSequence_companyId_key"
--   · 20260611_retention_voucher_format quiso quitarlo con
--       ALTER TABLE … DROP CONSTRAINT IF EXISTS "RetentionSequence_companyId_key"
--
-- Sobre un ÍNDICE suelto, `DROP CONSTRAINT IF EXISTS` es un NO-OP SILENCIOSO: no
-- falla, no avisa, no hace nada. Un `@unique` se materializa como CONSTRAINT (si la
-- columna estaba en el CREATE TABLE) o como ÍNDICE (si se añadió por ALTER), y cada
-- forma necesita su propio DROP. Por eso la migración 20260816_idempotency_key
-- distingue los dos casos: no era paranoia, el repo ya se había quemado con el
-- atajo y no se había enterado.
--
-- Y no se detectó en tres meses porque un único que SOBRA es invisible para Prisma:
-- no aparece en los tipos, no rompe el build, no falla ningún test. Sólo se
-- manifiesta como P2002 en producción. Se añade `scripts/verify-schema-drift.mjs`
-- para que esta clase deje de ser invisible.
--
-- POR QUÉ ES SEGURO
-- La unicidad correcta —`@@unique([companyId, year, month])`, índice
-- `RetentionSequence_companyId_year_month_key`— ya existe y se mantiene. Este DROP
-- sólo RELAJA: ninguna fila que hoy pasa empieza a fallar. Lo que arregla es que
-- vuelvan a poder INSERTARSE las que hoy se rechazan.
--
-- ROLLBACK (no debería hacer falta; restauraría el bug):
--   CREATE UNIQUE INDEX "RetentionSequence_companyId_key"
--     ON "RetentionSequence"("companyId");
--   -- Sólo funciona si no hay ya 2+ filas de la misma empresa.

DO $$
DECLARE
  obj_name text;
BEGIN
  -- Caso A: se materializó como CONSTRAINT
  SELECT c.conname INTO obj_name
    FROM pg_constraint c
    JOIN pg_class     rel ON rel.oid = c.conrelid
    JOIN pg_namespace n   ON n.oid   = rel.relnamespace
   WHERE n.nspname   = current_schema()
     AND rel.relname = 'RetentionSequence'
     AND c.contype   = 'u'
     AND (
           SELECT array_agg(a.attname::text ORDER BY a.attnum)
             FROM unnest(c.conkey) AS k(attnum)
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         ) = ARRAY['companyId']
   LIMIT 1;

  IF obj_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "RetentionSequence" DROP CONSTRAINT %I', obj_name);
    RAISE NOTICE 'SOLTADO constraint %', obj_name;
    obj_name := NULL;
  END IF;

  -- Caso B: se materializó como ÍNDICE suelto — el caso REAL aquí
  SELECT i.relname INTO obj_name
    FROM pg_index     x
    JOIN pg_class     i   ON i.oid   = x.indexrelid
    JOIN pg_class     rel ON rel.oid = x.indrelid
    JOIN pg_namespace n   ON n.oid   = rel.relnamespace
   WHERE n.nspname      = current_schema()
     AND rel.relname    = 'RetentionSequence'
     AND x.indisunique
     AND NOT x.indisprimary
     AND x.indnkeyatts  = 1
     AND x.indpred     IS NULL
     AND x.indexprs    IS NULL
     AND (
           SELECT a.attname
             FROM pg_attribute a
            WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
         ) = 'companyId'
   LIMIT 1;

  IF obj_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX %I', obj_name);
    RAISE NOTICE 'SOLTADO indice %', obj_name;
  END IF;

  -- Verificación: el correcto sigue vivo y el huérfano ya no está.
  -- Si el compuesto faltara, soltar el otro dejaría los correlativos SIN unicidad
  -- — que es peor que el bug que venimos a arreglar (un correlativo duplicado es
  -- una infracción SENIAT, Z-1). Por eso se comprueba, no se supone.
  IF to_regclass('"RetentionSequence_companyId_year_month_key"') IS NULL THEN
    RAISE EXCEPTION 'FALTA el unique (companyId, year, month) — abortando: dejaría los correlativos sin unicidad';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_index x
      JOIN pg_class i   ON i.oid = x.indexrelid
      JOIN pg_class rel ON rel.oid = x.indrelid
     WHERE rel.relname = 'RetentionSequence'
       AND x.indisunique AND NOT x.indisprimary AND x.indnkeyatts = 1
  ) THEN
    RAISE EXCEPTION 'Sigue habiendo un unique de una sola columna en RetentionSequence';
  END IF;
END $$;
