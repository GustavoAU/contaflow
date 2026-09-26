-- Feedback tester Alpha 2026-09-26 ("Pre." del plan de cuentas real): cuenta usable en
-- líneas de presupuesto. Default false preserva el comportamiento de toda cuenta existente.
ALTER TABLE "Account" ADD COLUMN "isBudgetable" BOOLEAN NOT NULL DEFAULT false;
