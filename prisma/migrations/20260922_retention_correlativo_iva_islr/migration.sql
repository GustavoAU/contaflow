-- 20260922_retention_correlativo_iva_islr
-- ADR-052 (Z-1) — confirmado con contador real 2026-09-22:
--
--   1. El correlativo de comprobante de retención de IVA (Prov. 0049) es
--      CONTINUO — NUNCA se reinicia. El esquema anterior (RetentionSequence,
--      migración 20260611_retention_voucher_format) lo reiniciaba cada mes por
--      un entendimiento incorrecto de la Providencia. Se corrige aquí.
--   2. IVA e ISLR llevan correlativos INDEPENDIENTES, no uno compartido. El de
--      ISLR sí se reinicia cada mes (el SENIAT no le exige formato fijo).
--
-- Verificado 2026-09-22 contra producción (proyecto Neon royal-voice-77113362):
-- 10 filas en Retencion, TODAS datos de prueba de alpha — NINGÚN comprobante
-- real fue emitido a un tercero bajo el esquema viejo. Confirmado con Gustavo
-- antes de escribir esta migración. Por eso se resetea limpio: RetentionSequence
-- se elimina por completo en vez de migrarse fila por fila.
--
-- ─── 1. Eliminar RetentionSequence (esquema viejo, ya no aplica) ─────────────
-- Los 10 registros de Retencion existentes conservan su voucherNumber histórico
-- (dato de prueba, no se toca) — solo se elimina la TABLA de secuencia que ya
-- no se usa para generar el siguiente número.

DROP TABLE IF EXISTS "RetentionSequence";

-- ─── 2. IvaRetentionSequence — una fila por empresa, contador CONTINUO ───────

CREATE TABLE "IvaRetentionSequence" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IvaRetentionSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IvaRetentionSequence_companyId_key" ON "IvaRetentionSequence"("companyId");

ALTER TABLE "IvaRetentionSequence"
  ADD CONSTRAINT "IvaRetentionSequence_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IvaRetentionSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IvaRetentionSequence" FORCE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON "IvaRetentionSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ─── 3. IslrRetentionSequence — igual al esquema viejo, pero solo para ISLR ──

CREATE TABLE "IslrRetentionSequence" (
  "id"         TEXT NOT NULL,
  "companyId"  TEXT NOT NULL,
  "year"       INTEGER NOT NULL,
  "month"      INTEGER NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IslrRetentionSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IslrRetentionSequence_companyId_year_month_key"
  ON "IslrRetentionSequence"("companyId", "year", "month");

ALTER TABLE "IslrRetentionSequence"
  ADD CONSTRAINT "IslrRetentionSequence_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IslrRetentionSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IslrRetentionSequence" FORCE ROW LEVEL SECURITY;

CREATE POLICY company_isolation ON "IslrRetentionSequence"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

-- ─── 4. Retencion.islrVoucherNumber — correlativo de ISLR independiente ──────

ALTER TABLE "Retencion" ADD COLUMN "islrVoucherNumber" TEXT;

CREATE UNIQUE INDEX "Retencion_companyId_islrVoucherNumber_unique"
  ON "Retencion"("companyId", "islrVoucherNumber")
  WHERE "islrVoucherNumber" IS NOT NULL;

-- ─── 5. Invoice.islrRetentionVoucher — espejo del campo denormalizado de IVA ─

ALTER TABLE "Invoice" ADD COLUMN "islrRetentionVoucher" TEXT;
