-- Feedback tester Alpha 2026-09-22: distinguir cuentas de título (no reciben JournalEntry) de
-- cuentas de detalle. Default true preserva el comportamiento de toda cuenta existente.
ALTER TABLE "Account" ADD COLUMN "isPostable" BOOLEAN NOT NULL DEFAULT true;
