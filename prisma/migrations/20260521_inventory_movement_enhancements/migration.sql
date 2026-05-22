-- Auditoría SENIAT R-02 + R-04:
-- R-02: tasa BCV histórica a la fecha del movimiento (obligatorio bajo normativa BCV/SENIAT)
-- R-04: cuenta contrapartida para completar el asiento de partida doble en movimientos manuales
--       ENTRADA: CR Proveedores/Caja. AJUSTE-: CR Merma/Pérdida. AJUSTE+: DR Sobrante.
ALTER TABLE "InventoryMovement"
  ADD COLUMN "counterpartAccountId" TEXT REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD COLUMN "exchangeRateVes" DECIMAL(10,4);
