-- F-02: tasa de cambio histórica vinculada a acumulación trimestral de prestaciones
-- Cuando el empleado tiene salario en moneda no-VES (ej. USD), el servicio de accrual
-- debe convertir el monto a VES usando la tasa BCV vigente y registrar qué tasa usó.
-- exchangeRateAtAccrual: tasa usada (Bs./USD) — NULL si salario es VES
-- originalCurrency: moneda original del salario — NULL si VES

ALTER TABLE "BenefitAccrualLine"
  ADD COLUMN "exchangeRateAtAccrual" DECIMAL(16, 4),
  ADD COLUMN "originalCurrency" VARCHAR(3);
