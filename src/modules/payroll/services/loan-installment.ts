// src/modules/payroll/services/loan-installment.ts
// Cuota de un préstamo a empleado. Módulo PURO (sin prisma) para que el servicio que
// crea el préstamo y la vista previa del formulario usen la MISMA fórmula: antes el
// formulario tenía una copia en floats que podía diferir un centimo de la guardada.
import { Decimal } from "decimal.js";

/**
 * Método francés: cuota fija = P × r(1+r)^n / ((1+r)^n − 1), con r = tasa anual / 12.
 * Si la tasa es null o 0 → cuota = total / n. En ambos casos se redondea HACIA ARRIBA
 * a 2 decimales (el último pago nunca queda corto).
 */
export function calcInstallment(
  principal: Decimal,
  installments: number,
  annualRate: Decimal | null
): Decimal {
  if (!annualRate || annualRate.isZero()) {
    return principal.dividedBy(installments).toDecimalPlaces(2, Decimal.ROUND_UP);
  }
  const r = annualRate.dividedBy(12); // tasa mensual
  const rn = r.plus(1).pow(installments); // (1+r)^n
  const cuota = principal.times(r.times(rn)).dividedBy(rn.minus(1));
  return cuota.toDecimalPlaces(2, Decimal.ROUND_UP);
}
