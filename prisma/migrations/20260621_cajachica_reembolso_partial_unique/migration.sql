-- Migration: 20260621_cajachica_reembolso_partial_unique
-- CC-01 follow-up (gate security-agent + ADR-035): reemplaza el índice único
-- INCONDICIONAL de reembolsos de caja chica por uno PARCIAL que excluye VOIDED.
--
-- Problema: @@unique([companyId, cajaCajaId, monthYear]) incluía las filas con
-- status=VOIDED. Como voidReimbursement libera los gastos (reimbursementId=null),
-- tras anular el borrador de un mes ya no se podía recrear el reembolso de ese mes
-- (P2002) → los gastos quedaban sin poder llegar al Libro Mayor (regresión CC-01).
--
-- Solución: índice único PARCIAL — la unicidad aplica solo a reembolsos vigentes.
-- Un mes puede tener N reembolsos VOIDED + a lo sumo 1 vigente (DRAFT o POSTED).
-- El service ya filtra status<>VOIDED en su check app-level; este índice es el
-- backstop de concurrencia ante dos creates simultáneos del mismo mes.

-- ─── Paso 1: Eliminar el índice único incondicional anterior ─────────────────
-- (índice único secundario, no PK; ninguna FK depende de estas columnas)

DROP INDEX IF EXISTS "caja_caja_reimbursements_companyId_cajaCajaId_month";

-- ─── Paso 2: Índice único parcial — solo reembolsos vigentes ─────────────────
-- Postgres coerce el literal 'VOIDED' al tipo enum de la columna (sin cast).

DROP INDEX IF EXISTS "caja_caja_reimbursements_companyId_cajaCajaId_month_active";
CREATE UNIQUE INDEX "caja_caja_reimbursements_companyId_cajaCajaId_month_active"
  ON "caja_caja_reimbursements"("companyId", "cajaCajaId", "monthYear")
  WHERE status <> 'VOIDED';
