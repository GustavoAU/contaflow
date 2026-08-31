-- LegalThreshold.verifiedAt — cuándo se confirmó por última vez que el tope sigue
-- vigente, distinto de cuándo entró en vigor el decreto.
--
-- La alerta NOM_SALARIO_MINIMO_VENCIDO medía la antigüedad de `effectiveFrom`,
-- que es la fecha del decreto. El salario mínimo venezolano lleva en Bs. 130
-- desde marzo de 2022 (Decreto 4.653, G.O. 42.339) porque los aumentos
-- posteriores han sido bonos NO salariales, que no mueven los topes. Con esa
-- lógica la alerta se disparaba todos los días por un dato correcto — y una
-- señal permanentemente encendida entrena a ignorarla, que es peor que no
-- tenerla.
--
-- Nullable a propósito: `null` significa "nadie lo ha confirmado todavía", y la
-- alerta cae entonces a `effectiveFrom` como hasta ahora. No hay backfill que
-- inventar una confirmación que nunca ocurrió.
ALTER TABLE "LegalThreshold"
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
