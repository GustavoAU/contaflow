// src/lib/fiscal-calendar.ts
//
// Calendario SENIAT Venezuela: fechas de vencimiento por último dígito del RIF.
// Referencia: Calendario SENIAT anual (publicado cada año en Gaceta Oficial).
// El patrón de días es estable; las fechas exactas pueden variar si caen en
// no hábiles, pero este módulo usa fechas calendario estándar como referencia.

// ─── Patrón IVA Forma 30 ─────────────────────────────────────────────────────
// La declaración del mes M vence en el mes M+1, en el día determinado por el
// último dígito del RIF (verificador, último dígito numérico del RIF).
const IVA_FORMA30_DAY: Record<number, number> = {
  1: 15, 2: 16, 3: 17, 4: 18, 5: 19,
  6: 20, 7: 21, 8: 22, 9: 23, 0: 24,
};

// ─── Patrón Retenciones IVA quincenal (solo Contribuyentes Especiales) ───────
// Primera quincena (días 1-15) → vence ~día 20 del mismo mes
// Segunda quincena (días 16-fin) → vence ~día 5 del mes siguiente
// (días aproximados; el SENIAT publica el calendario exacto cada año)
const RET_IVA_FIRST_QUINCENA_DAY  = 20;
const RET_IVA_SECOND_QUINCENA_DAY = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getLastRifDigit(rif: string): number | null {
  // Extrae el último dígito numérico del RIF (el verificador).
  // Formato esperado: J-12345678-9 → 9
  const match = rif.match(/(\d)\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

export type FiscalDeadlineType = "IVA_FORMA30" | "IVA_RETENCION_1Q" | "IVA_RETENCION_2Q";

export type FiscalDeadline = {
  type: FiscalDeadlineType;
  label: string;
  period: string;     // e.g. "Mayo 2026"
  dueDate: Date;
  daysUntil: number;
  severity: "overdue" | "urgent" | "warning" | "ok";
};

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function daysUntil(due: Date, today: Date): number {
  const diffMs = due.getTime() - today.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function severity(days: number): FiscalDeadline["severity"] {
  if (days < 0)  return "overdue";
  if (days <= 3) return "urgent";
  if (days <= 10) return "warning";
  return "ok";
}

// ─── IVA Forma 30 ─────────────────────────────────────────────────────────────

function ivaForma30Deadline(year: number, month: number, lastDigit: number): Date {
  // Declaración del mes M vence en día D del mes M+1
  const dueDay = IVA_FORMA30_DAY[lastDigit];
  const dueMonth = month === 12 ? 1  : month + 1;
  const dueYear  = month === 12 ? year + 1 : year;
  return new Date(Date.UTC(dueYear, dueMonth - 1, dueDay));
}

// ─── Retenciones IVA (Contribuyentes Especiales) ─────────────────────────────

function retIvaDeadlines(year: number, month: number): [Date, Date] {
  // Primera quincena → vence día 20 del mismo mes
  const d1 = new Date(Date.UTC(year, month - 1, RET_IVA_FIRST_QUINCENA_DAY));
  // Segunda quincena → vence día 5 del mes siguiente
  const nextMonth = month === 12 ? 1  : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const d2 = new Date(Date.UTC(nextYear, nextMonth - 1, RET_IVA_SECOND_QUINCENA_DAY));
  return [d1, d2];
}

// ─── API pública ──────────────────────────────────────────────────────────────

export type GenerateOptions = {
  /** Último dígito del RIF (0–9). */
  lastDigit: number;
  /** Fecha de referencia. Default: hoy. */
  today?: Date;
  /** Cuántos meses hacia adelante generar (default 12). */
  monthsAhead?: number;
  /** Si la empresa es Contribuyente Especial (agrega retenciones quincenal). */
  isSpecialContributor?: boolean;
};

export function generateFiscalDeadlines(opts: GenerateOptions): FiscalDeadline[] {
  const today     = opts.today     ?? new Date();
  const months    = opts.monthsAhead ?? 12;
  const isCE      = opts.isSpecialContributor ?? false;
  const today0    = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  const deadlines: FiscalDeadline[] = [];

  // Generar desde el mes anterior al actual hasta `months` meses adelante
  // para que siempre aparezca la declaración inmediatamente pasada como "overdue".
  const cursor = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1));
  const limit  = new Date(Date.UTC(today.getFullYear(), today.getMonth() + months, 1));

  while (cursor < limit) {
    const year  = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;

    // IVA Forma 30
    const ivaDate = ivaForma30Deadline(year, month, opts.lastDigit);
    const ivaDays = daysUntil(ivaDate, today0);
    deadlines.push({
      type:      "IVA_FORMA30",
      label:     "IVA Forma 30",
      period:    periodLabel(year, month),
      dueDate:   ivaDate,
      daysUntil: ivaDays,
      severity:  severity(ivaDays),
    });

    // Retenciones IVA (solo CE)
    if (isCE) {
      const [d1, d2] = retIvaDeadlines(year, month);
      const days1 = daysUntil(d1, today0);
      const days2 = daysUntil(d2, today0);
      deadlines.push({
        type:      "IVA_RETENCION_1Q",
        label:     "Ret. IVA 1ª quincena",
        period:    periodLabel(year, month),
        dueDate:   d1,
        daysUntil: days1,
        severity:  severity(days1),
      });
      deadlines.push({
        type:      "IVA_RETENCION_2Q",
        label:     "Ret. IVA 2ª quincena",
        period:    periodLabel(year, month),
        dueDate:   d2,
        daysUntil: days2,
        severity:  severity(days2),
      });
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Ordenar cronológicamente
  return deadlines.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}
