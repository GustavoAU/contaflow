// src/modules/payroll/utils/salary-vigencia.ts
//
// Qué sueldo rige en una fecha dada.
//
// Existe porque la pantalla y el cálculo aplicaban reglas distintas. El
// formulario de nómina listaba a cada trabajador con la vigencia MÁS RECIENTE de
// su sueldo, mientras que PayrollRunService toma la última vigente al INICIO del
// período (`effectiveFrom <= periodStart`). Las dos reglas coinciden siempre…
// salvo cuando un sueldo cambia dentro del propio período, que es justo cuando
// importa: un aumento de VES a USD con vigencia 20-08, en una nómina del 16 al
// 31-08, se listaba en USD y entraba al cálculo en VES. La nómina se rechazaba
// entera por "monedas mixtas" y la pantalla no daba manera de averiguar de quién
// salía la mezcla, porque ahí todos figuraban en la misma moneda.
//
// Las fechas se comparan como texto ISO (YYYY-MM-DD): ordena lexicográficamente
// igual que cronológicamente y no arrastra husos horarios. `effectiveFrom` es
// @db.Date —medianoche UTC— y pasarlo por un Date local corre el día.

import type { PayrollPaymentCurrency } from "@prisma/client";

/** Una vigencia de sueldo. `from` en formato ISO YYYY-MM-DD. */
export interface SalaryVigencia {
  from: string;
  currency: PayrollPaymentCurrency;
}

/**
 * Moneda del sueldo que rige en `dateISO`, o `null` si en esa fecha el
 * trabajador todavía no tenía sueldo registrado.
 *
 * El `null` no es un detalle: PayrollRunService descarta del cálculo a quien no
 * tenga vigencia al inicio del período (`filter(e => e.salaryHistory.length > 0)`),
 * sin error ni aviso. Quien lo muestre debe impedir que se le seleccione.
 *
 * `vigencias` debe venir ordenada de la más reciente a la más antigua.
 */
export function salaryCurrencyAt(
  vigencias: readonly SalaryVigencia[],
  dateISO: string,
): PayrollPaymentCurrency | null {
  return vigencias.find((v) => v.from <= dateISO)?.currency ?? null;
}
