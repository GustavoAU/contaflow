// src/lib/today.ts
//
// "Hoy" según el calendario de una persona — nunca según UTC.
//
// `new Date().toISOString().slice(0, 10)` NO devuelve la fecha de hoy: convierte
// el instante a UTC antes de recortar. En Venezuela (UTC−4) eso significa que
// entre las 20:00 y la medianoche devuelve MAÑANA:
//
//   Caracas, 10-ago 21:00  → toISOString() = "2026-08-11"   ✗ (es todavía el 10)
//   Caracas, 31-jul 22:00  → toISOString() = "2026-08-01"   ✗ OTRO PERÍODO CONTABLE
//
// El segundo caso es el peligroso: un pago, un asiento o una factura registrados
// la noche del último día del mes quedaban pre-llenados con el mes siguiente.
//
// Esta es la clase INVERSA a la que vigila `utc-date-getters.test.ts`: allá el
// error era leer con getters locales una fecha guardada a medianoche UTC; aquí es
// derivar un día calendario en UTC a partir de un instante que el usuario vive en
// su zona. Las dos se confunden con facilidad, así que la regla corta es:
//
//   · Fecha que YA está en la BD  → leerla con getters UTC (se guardó a 00:00 UTC).
//   · Fecha de HOY para el usuario → esta librería.
//
// Dónde usar cada función:
//   · Componente cliente ("use client")  → todayLocalISO() / currentMonthLocalISO()
//     El navegador conoce la zona del usuario; los getters locales son correctos.
//   · Servidor (Vercel corre en UTC)     → todayInTimeZone(cfg.timezone)
//     El proceso NO conoce la zona del usuario: hay que pasarla explícita, desde
//     `getFiscalConfig(country).timezone` (ADR-042).

/**
 * Serializa una fecha a `YYYY-MM-DD` leyendo sus componentes LOCALES.
 *
 * Es lo correcto para fechas construidas en local (`new Date(y, m, d)`) y para el
 * instante actual en el navegador. NO usar con fechas que vienen de la BD: esas
 * se guardan a medianoche UTC y quieren `getUTC*` (ver `utc-date-getters.test.ts`).
 */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Día de hoy (`YYYY-MM-DD`) en la zona horaria del proceso.
 *
 * Pensado para componentes cliente, donde la zona del proceso ES la del usuario.
 * En el servidor devuelve el día UTC — que es justo lo que hay que evitar; ahí va
 * `todayInTimeZone`.
 */
export function todayLocalISO(now: Date = new Date()): string {
  return toLocalISODate(now);
}

/**
 * Mes de hoy (`YYYY-MM`) en la zona horaria del proceso. Cliente.
 *
 * Equivalente de `todayLocalISO` para los `input type="month"`. Solo se desvía el
 * último día del mes, pero es exactamente el día en que más duele.
 */
export function currentMonthLocalISO(now: Date = new Date()): string {
  return todayLocalISO(now).slice(0, 7);
}

/**
 * Día de hoy (`YYYY-MM-DD`) en una zona horaria IANA explícita. Servidor.
 *
 * `en-CA` produce `YYYY-MM-DD`, pero no dependemos de ese detalle: se leen las
 * partes por nombre. Ante una zona inválida `Intl` lanza `RangeError`; en ese
 * caso caemos al día UTC, que es el comportamiento que ya había — degradar es
 * preferible a tumbar el render de una página.
 */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value;

    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (!y || !m || !d) return now.toISOString().slice(0, 10);
    return `${y}-${m}-${d}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
