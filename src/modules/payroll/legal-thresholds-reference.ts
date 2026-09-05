// src/modules/payroll/legal-thresholds-reference.ts
//
// Valores de referencia de los topes legales venezolanos, verificados contra
// texto primario de Gaceta Oficial (memoria nomina-venezuela-bases-legales,
// citas confirmadas con Gustavo en la sesión que sembró este archivo).
//
// Esta es la fuente que la app usa para AVISAR si el valor guardado por una
// empresa no coincide con el vigente — NUNCA para escribirlo sola. Un tope mal
// escrito automáticamente corrompe las cotizaciones de TODAS las empresas a la
// vez y en silencio; por eso el mecanismo es siempre "avisa y el contador
// confirma", nunca "sobrescribe".
//
// Mantenimiento: hoy lo actualiza Gustavo a mano (equipo de una persona) cuando
// sale un decreto o una reforma nueva — no hay servicio ni API oficial
// venezolana que lo automatice, y raspar una web del Estado y escribir un tope
// equivocado es exactamente el riesgo que este archivo existe para evitar. Cada
// cambio pasa por el mismo tsc+vitest+build de cualquier otro código: el
// historial de git documenta cuándo cambió y por qué.
//
// Unidades: las tasas parafiscales del calculador viven en PayrollCalculatorService
// como FRACCIÓN (0.04 = 4%, la que se multiplica directo contra el salario).
// Aquí se convierten a PUNTOS PORCENTUALES (4.00) porque así es como
// `LegalThreshold.value` se guarda y se muestra (LegalThresholdsPanel imprime
// "{value}%" tal cual — ver línea 261 de ese componente). Se derivan con
// `pct()` desde la MISMA constante que usa el calculador, nunca tecleadas de
// nuevo: si algún día no coinciden, es porque alguien cambió una y olvidó la
// otra, y eso es exactamente lo que este comentario quiere impedir.

import Decimal from "decimal.js";
import type { IvssRiskClass } from "@prisma/client";
import {
  IVSS_PAT_RATE_BY_RISK,
  DEFAULT_IVSS_WORKER_RATE,
  DEFAULT_INCES_PAT_RATE,
  DEFAULT_FAOV_WORKER_RATE,
  DEFAULT_FAOV_PAT_RATE,
  DEFAULT_RPE_WORKER_RATE,
  DEFAULT_RPE_PAT_RATE,
} from "./services/PayrollCalculatorService";

function pct(fraccion: Decimal): Decimal {
  return fraccion.times(100);
}

/**
 * Bs./mes. Decreto 4.653 (G.O. 42.339 Extraordinario, 01-03-2022). Congelado
 * desde entonces: los aumentos posteriores (Cestaticket, Bono contra la Guerra
 * Económica — Decreto 4.805, G.O. 6.746 Extraordinario) son bonos SIN
 * incidencia salarial y no mueven este valor, aunque el "ingreso mínimo
 * integral" resultante sea mucho mayor. Confundir el bono con el salario
 * mínimo hace que los topes de IVSS/FAOV/INCES/RPE se calculen sobre una base
 * que la ley no reconoce.
 *
 * Última verificación de vigencia: 2026-09 (fuentes fechadas ese mismo mes
 * coinciden en que sigue congelado).
 */
export const SALARY_MIN_VES_REFERENCE = new Decimal("130.00");

/**
 * Tasas parafiscales de referencia en PUNTOS PORCENTUALES, derivadas de las
 * mismas constantes que usa `PayrollCalculatorService` — nunca una copia
 * tecleada aparte.
 *
 * `INCES_OBR_RATE` es la excepción: no se deriva de nada porque el motor no
 * calcula ese concepto todavía (0,5% sobre utilidades/aguinaldos anuales, Ley
 * INCES Art. 50 — no es una deducción mensual sobre el sueldo, y hoy no existe
 * en `PayrollCalculatorService`). Se documenta aquí igual porque es un valor
 * legal confirmado y sembrarlo ahora no cuesta nada; que el motor lo calcule
 * es trabajo futuro, no de este cambio.
 */
export const RATE_REFERENCE_PCT: {
  IVSS_OBR_RATE: Decimal;
  INCES_OBR_RATE: Decimal;
  INCES_PAT_RATE: Decimal;
  FAOV_OBR_RATE: Decimal;
  FAOV_PAT_RATE: Decimal;
  RPE_OBR_RATE: Decimal;
  RPE_PAT_RATE: Decimal;
} = {
  IVSS_OBR_RATE: pct(DEFAULT_IVSS_WORKER_RATE),   // LSS Reglamento Art. 108 — 4%
  INCES_OBR_RATE: new Decimal("0.50"),            // Ley INCES Art. 50 — 0,5% sobre utilidades/aguinaldos
  INCES_PAT_RATE: pct(DEFAULT_INCES_PAT_RATE),     // Ley INCES Art. 49 — 2%
  FAOV_OBR_RATE: pct(DEFAULT_FAOV_WORKER_RATE),    // LRPVH Art. 33 (G.O. 6.805, 01-05-2024) — 1%
  FAOV_PAT_RATE: pct(DEFAULT_FAOV_PAT_RATE),       // LRPVH Art. 33 (G.O. 6.805, 01-05-2024) — 2%
  RPE_OBR_RATE: pct(DEFAULT_RPE_WORKER_RATE),      // RPE Art. 46 (G.O. 38.281) — 0,5%
  RPE_PAT_RATE: pct(DEFAULT_RPE_PAT_RATE),         // RPE Art. 46 (G.O. 38.281) — 2,0%
};

/**
 * IVSS patronal depende de la clase de riesgo (LSS Reglamento Art. 108/109):
 * no es un valor único, así que queda fuera de `RATE_REFERENCE_PCT`.
 */
export const IVSS_PAT_RATE_REFERENCE_PCT: Record<IvssRiskClass, Decimal> = {
  MINIMO: pct(IVSS_PAT_RATE_BY_RISK.MINIMO), // 9%
  MEDIO: pct(IVSS_PAT_RATE_BY_RISK.MEDIO),   // 10% — clase residual
  MAXIMO: pct(IVSS_PAT_RATE_BY_RISK.MAXIMO), // 11%
};

// Deliberadamente SIN valor de referencia:
//
// - UT_VALUE (Unidad Tributaria): existe como opción en el formulario de topes
//   legales, pero ningún cálculo de nómina la usa todavía. No hay nada real
//   con qué compararla.
//
// - La "Ley de Protección de las Pensiones de Seguridad Social Frente al
//   Bloqueo Imperialista" (G.O. 6.806 Extraordinario, 08-05-2024; tasa fijada
//   en 9% por Decreto 4.952, G.O. 42.880) es una contribución patronal real y
//   separada que ContaFlow NO calcula en ningún lado hoy: no tiene
//   `LegalThresholdType`, ni cuenta GL, ni línea en el calculador. Investigada
//   y verificada contra finanzasdigital.com (misma fuente que ya se usó para
//   verificar el FAOV) el 2026-09; queda fuera de este archivo a propósito
//   porque no es un tope existente que se pueda sembrar — es una funcionalidad
//   nueva pendiente de decisión.
