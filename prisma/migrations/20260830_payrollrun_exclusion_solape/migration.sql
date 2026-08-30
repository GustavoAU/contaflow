-- PayrollRun: el solapamiento de períodos lo impide la BASE DE DATOS.
--
-- Por qué una restricción de exclusión y no un advisory lock: un candado impide
-- una CARRERA; esto impide ESTAR EQUIVOCADO. El candado es una convención —sólo
-- protege si todo el que escribe se acuerda de tomarlo, y un camino nuevo que lo
-- olvide pierde la protección en silencio—. La restricción la impone el motor
-- sobre cualquier escritura, venga de donde venga.
--
-- El argumento decisivo es empírico: los dos defectos de este módulo se
-- escribieron SIN carrera de por medio (el `coveredDays` que sumaba duraciones y
-- el backfill que dejó un borrador en el segmento equivocado). Un candado no
-- habría evitado ninguno.
--
-- Y expresa el invariante COMPLETO, que ningún índice único puede: 01-15 y 01-31
-- son pares de fechas distintos —invisibles para un unique— y con la misma gente
-- son doble pago. `&&` sobre daterange sí los ve.
--
-- Sigue permitiendo lo que el arreglo de hoy desbloqueó: dos procesos del mismo
-- período en MONEDAS distintas, porque `currencySegment` entra en la clave.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- El único parcial queda subsumido: un rango se solapa consigo mismo, así que la
-- exclusión también cubre el período idéntico. Mantener los dos sería un segundo
-- índice que encarece cada escritura y duplica el camino de error.
DROP INDEX IF EXISTS "PayrollRun_companyId_period_segment_active_key";

ALTER TABLE "PayrollRun"
  DROP CONSTRAINT IF EXISTS "PayrollRun_no_overlap_active";

-- `[]` = ambos extremos inclusivos: periodEnd es el último día trabajado, no el
-- día siguiente. Con `[)` una nómina 01-15 y otra 15-31 no se verían solapadas y
-- el día 15 se pagaría dos veces.
ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_no_overlap_active"
  EXCLUDE USING gist (
    "companyId"       WITH =,
    "currencySegment" WITH =,
    daterange("periodStart", "periodEnd", '[]') WITH &&
  )
  WHERE (status <> 'CANCELLED');
