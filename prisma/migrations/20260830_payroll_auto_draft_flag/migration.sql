-- PayrollConfig.autoDraftEnabled — opt-in al borrador automático de nómina.
--
-- Opt-in y no opt-out porque crear un borrador NO es inocuo: reserva las horas
-- extra del período (mientras estén tomadas ningún otro proceso las ve, y sólo
-- cancelar las libera), ocupa la única ranura vigente de ese período y moneda, y
-- puede escribir conceptos del sistema. Activarlo para todos sin pedirlo les
-- cambiaría el comportamiento con esos tres efectos.
--
-- ADD COLUMN booleano NOT NULL con default es cambio sólo de metadatos en
-- PostgreSQL >= 11: instantáneo, sin reescritura de tabla ni backfill.
ALTER TABLE "PayrollConfig"
  ADD COLUMN IF NOT EXISTS "autoDraftEnabled" BOOLEAN NOT NULL DEFAULT false;
