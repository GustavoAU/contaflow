-- M8: Correlativo uniforme Libro Diario (Código de Comercio Arts. 32-36)
-- JournalSequence: contador mensual por empresa
-- Trigger: auto-popula Transaction.journalNumber en cada INSERT (BEFORE)

-- 1. Tabla de secuencias
CREATE TABLE IF NOT EXISTS "JournalSequence" (
  "id"          TEXT         NOT NULL,
  "companyId"   TEXT         NOT NULL,
  "year"        INTEGER      NOT NULL,
  "month"       INTEGER      NOT NULL,
  "lastNumber"  INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "JournalSequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalSequence_companyId_year_month_key"
    UNIQUE ("companyId", "year", "month"),
  CONSTRAINT "JournalSequence_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. Campo journalNumber en Transaction (nullable — registros históricos quedan NULL)
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "journalNumber" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_companyId_journalNumber_idx"
  ON "Transaction" ("companyId", "journalNumber");

-- 3. Función PL/pgSQL que asigna el correlativo
CREATE OR REPLACE FUNCTION fn_next_journal_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year   INTEGER;
  v_month  INTEGER;
  v_next   INTEGER;
BEGIN
  -- Solo actúa cuando el campo llega NULL (permite override manual en tests)
  IF NEW."journalNumber" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_year  := EXTRACT(YEAR  FROM NEW."date")::INTEGER;
  v_month := EXTRACT(MONTH FROM NEW."date")::INTEGER;

  INSERT INTO "JournalSequence" ("id", "companyId", "year", "month", "lastNumber")
  VALUES (gen_random_uuid(), NEW."companyId", v_year, v_month, 1)
  ON CONFLICT ("companyId", "year", "month")
  DO UPDATE SET "lastNumber" = "JournalSequence"."lastNumber" + 1
  RETURNING "lastNumber" INTO v_next;

  NEW."journalNumber" :=
    v_year::TEXT || '-' ||
    LPAD(v_month::TEXT, 2, '0') || '-' ||
    LPAD(v_next::TEXT, 6, '0');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger BEFORE INSERT en Transaction
DROP TRIGGER IF EXISTS trg_transaction_journal_number ON "Transaction";
CREATE TRIGGER trg_transaction_journal_number
  BEFORE INSERT ON "Transaction"
  FOR EACH ROW
  EXECUTE FUNCTION fn_next_journal_number();
