-- Reglamento General de la Ley del Seguro Social (G.O. 30-04-2012):
--   Art. 108 — las empresas se agrupan en tres categorias de riesgo.
--   Art. 109 — tarifa patronal: Minimo 9%, Medio 10%, Maximo 11%.
--              El aporte del asegurado es 4% en las tres.
--   Art. 192 — Riesgo Medio: "todas las empresas que no esten expresamente
--              incluidas en otra clase".
--
-- El calculador tenia el 9% (Riesgo Minimo) cableado como unica tarifa
-- patronal. El Reglamento hace del MEDIO la clase residual, asi que ese es el
-- default: las empresas existentes pasan a 10% salvo que el contador declare
-- otra clase. Riesgo Minimo es una lista cerrada y corta (empresas sin fuerza
-- motriz, docentes, ciertas fabricas, beneficio de cafe y cacao).

CREATE TYPE "IvssRiskClass" AS ENUM ('MINIMO', 'MEDIO', 'MAXIMO');

ALTER TABLE "PayrollConfig"
  ADD COLUMN "ivssRiskClass" "IvssRiskClass" NOT NULL DEFAULT 'MEDIO';
