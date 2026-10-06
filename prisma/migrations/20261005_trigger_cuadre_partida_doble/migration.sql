-- SPEC-001 / ADR-060: el cuadre de partida doble lo garantiza la BASE DE DATOS.
--
-- Hasta hoy "débitos = créditos" solo se validaba en la aplicación (assertBalancedGLEntries). Cualquier
-- escritura que no pasara por esos servicios (un script de prisma/, un $executeRaw, una migración de
-- datos, un módulo nuevo) podía dejar un asiento descuadrado sin que nada lo detuviera. Esta migración
-- añade la última línea de defensa: un CONSTRAINT TRIGGER diferido que, al hacer COMMIT, comprueba que
-- cada asiento tocado en la transacción sume EXACTAMENTE 0.
--
-- Decisiones (ADR-060):
--   * T = 0 (cuadre exacto, decidido por la contadora el 2026-10-03). Está en una constante de la
--     función (v_tolerance) para poder cambiarla en un solo sitio.
--   * DIFERIDO (DEFERRABLE INITIALLY DEFERRED): un servicio puede insertar las líneas una por una dentro
--     del mismo $transaction; solo importa el estado al COMMIT.
--   * Solo revisa los asientos TOCADOS (por el transactionId de la fila afectada), nunca la tabla
--     completa; ni valida filas ya existentes al crearse el trigger.
--   * UPDATE solo se vigila sobre "amount" y "transactionId" (cambiar la descripción no afecta al cuadre);
--     si una línea cambia de asiento se comprueban los DOS.
--   * Una Transaction sin líneas no dispara nada (no hay fila de JournalEntry que lo active).
--   * SQLSTATE propio 'CF001' y marcador "CF001:" al inicio del mensaje: la aplicación lo reconoce con
--     isUnbalancedEntryError() y devuelve un mensaje de negocio (nunca el error crudo del motor).
--
-- Repetible desde una base vacía (ADR-057): CREATE OR REPLACE / DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION fn_check_journal_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- T: tolerancia del cuadre, en Bs. 0 = EXACTO (ADR-060).
  v_tolerance CONSTANT numeric := 0;
  v_tx_id text;
  v_sum numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tx_id := OLD."transactionId";
  ELSE
    v_tx_id := NEW."transactionId";
  END IF;

  SELECT COALESCE(SUM("amount"), 0) INTO v_sum
  FROM "JournalEntry"
  WHERE "transactionId" = v_tx_id;

  IF ABS(v_sum) > v_tolerance THEN
    RAISE EXCEPTION 'CF001: asiento descuadrado (transactionId=%, suma=%). Débitos y créditos deben ser iguales.', v_tx_id, v_sum
      USING ERRCODE = 'CF001';
  END IF;

  -- Una línea que cambia de asiento deja descuadrado al asiento de ORIGEN además del destino.
  IF TG_OP = 'UPDATE' AND OLD."transactionId" IS DISTINCT FROM NEW."transactionId" THEN
    SELECT COALESCE(SUM("amount"), 0) INTO v_sum
    FROM "JournalEntry"
    WHERE "transactionId" = OLD."transactionId";

    IF ABS(v_sum) > v_tolerance THEN
      RAISE EXCEPTION 'CF001: asiento descuadrado (transactionId=%, suma=%). Débitos y créditos deben ser iguales.', OLD."transactionId", v_sum
        USING ERRCODE = 'CF001';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION fn_check_journal_balance() IS
  'SPEC-001 / ADR-060: al COMMIT, cada asiento tocado debe sumar exactamente 0 (SQLSTATE CF001).';

DROP TRIGGER IF EXISTS "trg_journalentry_balance" ON "JournalEntry";

CREATE CONSTRAINT TRIGGER "trg_journalentry_balance"
  AFTER INSERT OR UPDATE OF "amount", "transactionId" OR DELETE
  ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_journal_balance();
