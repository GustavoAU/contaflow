// src/modules/payroll/services/payroll-currency.ts
//
// Conversión de sueldos a bolívares para los cálculos que terminan en un asiento
// contable (liquidaciones, vacaciones, utilidades).
//
// Por qué existe: `SalaryHistory` guarda `amount` Y `currency`, pero tres
// servicios leían sólo `amount` y lo mandaban al Libro Diario tal cual. Un sueldo
// de USD 2.500 producía un pasivo de "2.500" bolívares en vez de ~1.950.000 —
// mal por el factor exacto de la tasa. Es la misma clase de error que H-4
// corrigió en el calculador de cotizaciones (allá el tope, aquí el asiento).
//
// Se centraliza en vez de repetir el bloque en cada servicio: el primero que se
// corrigió fue TerminationService, y copiarlo dos veces más garantizaba que la
// próxima corrección se aplicara sólo en uno de los tres.

import prisma from "@/lib/prisma";
import Decimal from "decimal.js";
import type { PayrollPaymentCurrency } from "@prisma/client";

// Fuente única de los mensajes de moneda de todo el módulo. Había dos parejas
// —una aquí y otra en PayrollCalculatorService— con textos distintos para la
// misma condición: el usuario veía un mensaje u otro según si llegaba por la
// nómina ordinaria o por liquidación, vacaciones o utilidades. El calculador las
// re-exporta (mismo patrón que ADR-041 con ActionResult).
export const MISSING_BCV_RATE_MESSAGE =
  "Sueldo en USD: registra la tasa BCV USD/VES en Contabilidad → Tasas de Cambio " +
  "antes de continuar. Los topes legales (IVSS, FAOV, INCES, RPE) están fijados " +
  "en bolívares y no pueden aplicarse a un sueldo en dólares sin la tasa, y el " +
  "asiento contable se registra en bolívares.";

export const MIXED_SALARY_MESSAGE =
  "El empleado tiene el sueldo en modalidad MIXTA: es un solo monto que no dice " +
  "cuánto va en bolívares y cuánto en divisas, así que no se puede repartir sin " +
  "inventar la proporción. Divide el sueldo en dos registros de salario, uno por " +
  "moneda, antes de continuar.";

/**
 * Tasa BCV Bs./USD vigente a `atDate` (la más reciente con fecha ≤ atDate).
 * `null` si no hay ninguna registrada.
 *
 * Se expone aparte de la conversión para que un llamador que convierte muchas
 * filas —el promedio salarial de utilidades, por ejemplo— haga una sola consulta.
 */
export async function bcvRateAt(
  companyId: string,
  atDate: Date,
): Promise<Decimal | null> {
  const row = await prisma.exchangeRate.findFirst({
    where: { companyId, currency: "USD", date: { lte: atDate } },
    orderBy: { date: "desc" },
    select: { rate: true },
  });
  return row ? new Decimal(row.rate.toString()) : null;
}

/**
 * Convierte un monto de sueldo a bolívares.
 *
 * Lanza —en vez de asumir— cuando no puede hacerlo: un asiento con la cifra
 * equivocada es peor que un proceso que se detiene y dice por qué.
 */
export function salaryAmountToVes(
  amount: Decimal,
  currency: PayrollPaymentCurrency,
  bcvRate: Decimal | null,
): Decimal {
  if (currency === "VES") return amount;
  if (currency === "MIXED") throw new Error(MIXED_SALARY_MESSAGE);
  if (!bcvRate || bcvRate.lte(0)) throw new Error(MISSING_BCV_RATE_MESSAGE);
  return amount.mul(bcvRate);
}

/**
 * Atajo para el caso de una sola fila: resuelve la tasa y convierte.
 *
 * Simplificación consciente, heredada de TerminationService: se usa una única
 * tasa —la vigente a `atDate`— para todos los conceptos del cálculo. Los montos
 * históricos se devengaron con las tasas de su momento; convertir cada tramo con
 * la suya exigiría recorrer el historial de tasas y es trabajo aparte.
 */
export async function monthlyWageToVes(
  companyId: string,
  salary: { amount: { toString(): string }; currency: PayrollPaymentCurrency },
  atDate: Date,
): Promise<Decimal> {
  const amount = new Decimal(salary.amount.toString());
  if (salary.currency === "VES") return amount;
  return salaryAmountToVes(amount, salary.currency, await bcvRateAt(companyId, atDate));
}
