-- Ley del INCES (Decreto 1.414, G.O. 6.155 Extraordinario), Art. 50:
-- el aporte del trabajador es "el cero coma cinco por ciento (0,5%) de sus
-- utilidades anuales, aguinaldos o bonificaciones de fin de ano".
-- No es una deduccion mensual sobre el sueldo, que es donde estaba.

ALTER TABLE "ProfitSharingRecord"
  ADD COLUMN "incesRetention" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- Los registros historicos quedan en 0: la retencion no se practico sobre
-- utilidades en su momento (se venia cobrando mes a mes en nomina), y rellenarlos
-- ahora seria inventar un dato que nunca ocurrio.
