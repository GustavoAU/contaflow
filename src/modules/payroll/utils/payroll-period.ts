// src/modules/payroll/utils/payroll-period.ts
//
// Los límites del período de nómina, según la frecuencia configurada.
//
// Existe porque `PayrollConfig.frequency` era decorativo: el formulario proponía
// SIEMPRE quincenas sin mirarlo (cero referencias al campo). Una empresa
// configurada MONTHLY llevaba meses procesando 16→31, así que la configuración y
// la práctica decían cosas distintas — la misma clase de defecto que dos capas
// aplicando reglas distintas.
//
// Las fechas se manejan como texto ISO (YYYY-MM-DD) y nunca con `new Date()`
// dentro: "hoy" lo decide quien llama, que es el único que sabe en qué zona está
// el usuario. Derivarlo aquí daba el día equivocado — en el render del servidor
// `new Date()` es UTC, que después de las 20:00 en Venezuela ya es mañana.

import type { PayrollFrequency } from "@prisma/client";

export interface PeriodoNomina {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Último día del mes, en calendario UTC para no arrastrar husos. */
function ultimoDiaDelMes(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

/**
 * Período que propone el formulario para `todayISO`.
 *
 * SEMANAL no tiene ancla en la configuración —no hay día de pago ni primera
 * semana registrados—, así que se propone la semana natural (lunes a domingo)
 * que contiene la fecha. Es una propuesta editable, no una afirmación.
 */
export function periodoPorDefecto(
  todayISO: string,
  frequency: PayrollFrequency,
): PeriodoNomina {
  const { y, m, d } = parseISO(todayISO);
  const mm = pad(m);
  const ultimo = ultimoDiaDelMes(y, m);

  if (frequency === "MONTHLY") {
    return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${pad(ultimo)}` };
  }

  if (frequency === "SEMANAL") {
    // getUTCDay: 0 = domingo. Se retrocede al lunes de esa semana.
    const base = new Date(Date.UTC(y, m - 1, d));
    const diaSemana = base.getUTCDay();
    const alLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(base);
    lunes.setUTCDate(lunes.getUTCDate() - alLunes);
    const domingo = new Date(lunes);
    domingo.setUTCDate(domingo.getUTCDate() + 6);
    return {
      start: lunes.toISOString().slice(0, 10),
      end: domingo.toISOString().slice(0, 10),
    };
  }

  // BIWEEKLY
  return d <= 15
    ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` }
    : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${pad(ultimo)}` };
}

/**
 * Fin que corresponde a un inicio elegido a mano.
 *
 * No fuerza el inicio: si el contador escribe una fecha que no es corte —porque
 * está regularizando algo— se respeta y sólo se propone un fin coherente.
 */
export function finDesdeInicio(
  startISO: string,
  frequency: PayrollFrequency,
): string {
  const { y, m, d } = parseISO(startISO);
  const mm = pad(m);
  const ultimo = ultimoDiaDelMes(y, m);

  if (frequency === "MONTHLY") return `${y}-${mm}-${pad(ultimo)}`;

  if (frequency === "SEMANAL") {
    const fin = new Date(Date.UTC(y, m - 1, d));
    fin.setUTCDate(fin.getUTCDate() + 6);
    return fin.toISOString().slice(0, 10);
  }

  return d <= 15 ? `${y}-${mm}-15` : `${y}-${mm}-${pad(ultimo)}`;
}
