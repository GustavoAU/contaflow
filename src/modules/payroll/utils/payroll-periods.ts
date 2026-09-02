// src/modules/payroll/utils/payroll-periods.ts
//
// Cálculo puro de los períodos de nómina de una empresa a partir de los días
// que USA COMO INICIO. Sin prisma: se puede importar desde cualquier capa y se
// prueba sin base de datos.
//
// Por qué los días y no `PayrollConfig.frequency`: ese campo es decorativo en la
// práctica —`getDefaultPeriod()` del formulario propone quincenas sin mirarlo—,
// así que una empresa configurada MONTHLY puede llevar meses procesando 16→31.
// Los días reales salen del historial de procesos; la frecuencia queda de
// respaldo sólo cuando no hay historial.

export interface PeriodoNomina {
  /** Medianoche UTC del primer día. `@db.Date` guarda medianoche UTC. */
  inicio: Date;
  /** Medianoche UTC del último día, inclusive. */
  fin: Date;
}

function diasDelMes(anio: number, mes0: number): number {
  return new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
}

/** Períodos que caben en un mes dados los días de corte. El último llega
 *  siempre a fin de mes: febrero termina el 28/29, no el 31. */
export function periodosDelMes(anio: number, mes0: number, diasInicio: number[]): PeriodoNomina[] {
  const total = diasDelMes(anio, mes0);
  const inicios = [...new Set(diasInicio.map((d) => Math.min(Math.max(d, 1), total)))].sort(
    (a, b) => a - b,
  );
  return inicios.map((dia, i) => ({
    inicio: new Date(Date.UTC(anio, mes0, dia)),
    fin: new Date(Date.UTC(anio, mes0, i + 1 < inicios.length ? inicios[i + 1] - 1 : total)),
  }));
}

/**
 * Último período que YA TERMINÓ a fecha de `hoyUTC` — el que toca cobrar.
 *
 * Se mira el mes en curso y el anterior: el 1 de septiembre el período cerrado
 * es el 16→31 de agosto, no el 1→15 de septiembre, que ni siquiera ha empezado.
 *
 * Devuelve `null` si no hay días de corte (nómina semanal: cualquier lunes es
 * inicio de período y no hay ancla del ciclo en la configuración).
 */
export function ultimoPeriodoCerrado(diasInicio: number[], hoyUTC: Date): PeriodoNomina | null {
  if (diasInicio.length === 0) return null;

  const anio = hoyUTC.getUTCFullYear();
  const mes0 = hoyUTC.getUTCMonth();
  // Date.UTC normaliza mes -1 al diciembre del año anterior.
  const anterior = new Date(Date.UTC(anio, mes0 - 1, 1));
  const hoySinHora = Date.UTC(anio, mes0, hoyUTC.getUTCDate());

  const candidatos = [
    ...periodosDelMes(anterior.getUTCFullYear(), anterior.getUTCMonth(), diasInicio),
    ...periodosDelMes(anio, mes0, diasInicio),
  ].filter((p) => p.fin.getTime() < hoySinHora);

  if (candidatos.length === 0) return null;
  return candidatos.reduce((a, b) => (b.fin.getTime() > a.fin.getTime() ? b : a));
}

/** Días transcurridos desde que cerró el período. Sirve para escalar el aviso:
 *  el día siguiente al cierre es normal que no esté procesada; una semana
 *  después ya no. */
export function diasDesdeCierre(periodo: PeriodoNomina, hoyUTC: Date): number {
  const hoySinHora = Date.UTC(hoyUTC.getUTCFullYear(), hoyUTC.getUTCMonth(), hoyUTC.getUTCDate());
  return Math.round((hoySinHora - periodo.fin.getTime()) / 86_400_000);
}
