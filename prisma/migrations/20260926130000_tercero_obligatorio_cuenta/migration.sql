-- ADR-054: "Ter." del plan de cuentas real — algunas cuentas exigen indicar A QUIÉN pertenece
-- cada movimiento (Customer/Vendor/Partner/Employee). El tercero vive en JournalEntry, no en
-- Transaction: PaymentGLService.postPaymentBatchGL ya arma UN asiento que paga a VARIOS
-- proveedores distintos en sus distintas líneas.

-- ─── Partner (socio/accionista) — el único tercero sin modelo hoy ────────────────────────────
CREATE TABLE IF NOT EXISTS "Partner" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "rif"       TEXT,
  "notes"     TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Partner" DROP CONSTRAINT IF EXISTS "Partner_companyId_fkey";
ALTER TABLE "Partner"
  ADD CONSTRAINT "Partner_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Partner_companyId_rif_key" ON "Partner" ("companyId", "rif");
CREATE INDEX IF NOT EXISTS "Partner_companyId_deletedAt_idx" ON "Partner" ("companyId", "deletedAt");

-- ADR-007 A1-bis: RLS en la MISMA migración que crea el modelo.
ALTER TABLE "Partner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Partner" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_isolation ON "Partner";
CREATE POLICY company_isolation ON "Partner"
  USING (("companyId")::text = current_setting('app.current_company_id', true))
  WITH CHECK (("companyId")::text = current_setting('app.current_company_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Partner" TO authenticated;

-- ─── Account.requiresThirdParty ────────────────────────────────────────────────────────────────
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "requiresThirdParty" BOOLEAN NOT NULL DEFAULT false;

-- ─── JournalEntry: 4 columnas de tercero, mutuamente excluyentes ──────────────────────────────
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "vendorId"   TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "partnerId"  TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_customerId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_vendorId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_partnerId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_employeeId_fkey";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "JournalEntry_customerId_idx" ON "JournalEntry" ("customerId");
CREATE INDEX IF NOT EXISTS "JournalEntry_vendorId_idx"   ON "JournalEntry" ("vendorId");
CREATE INDEX IF NOT EXISTS "JournalEntry_partnerId_idx"  ON "JournalEntry" ("partnerId");
CREATE INDEX IF NOT EXISTS "JournalEntry_employeeId_idx" ON "JournalEntry" ("employeeId");

-- A lo sumo UN tercero por línea. El DSL de Prisma no expresa esto (mismo caso que
-- company_country_iso3166_alpha3) — se agrega a mano.
ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "journal_entry_single_party";
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "journal_entry_single_party"
  CHECK (num_nonnulls("customerId", "vendorId", "partnerId", "employeeId") <= 1);
