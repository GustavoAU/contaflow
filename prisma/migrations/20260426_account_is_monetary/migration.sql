-- VEN-NIF 3 §36.2: Partida monetaria — Caja/Bancos/CxC/CxP no se reexpresan por INPC
ALTER TABLE "Account" ADD COLUMN "isMonetary" BOOLEAN NOT NULL DEFAULT false;
