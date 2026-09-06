// src/modules/payroll/utils/sal-min-alert.ts
//
// Bug encontrado en vivo (2026-09-05): la alerta de salario mínimo en
// PayrollRunForm medía SOLO la antigüedad de `effectiveFrom`/`verifiedAt`, así
// que un valor CORRECTO pero decretado hace años disparaba "desactualizado"
// todos los días — el salario mínimo venezolano lleva congelado en Bs. 130
// desde marzo de 2022 (los aumentos posteriores fueron bonos NO salariales,
// que no mueven este tope). Mismo bug que NOM_SALARIO_MINIMO_VENCIDO ya tenía
// corregido en PendingTasksService (dashboard), sin barrer aquí.
//
// El VALOR manda sobre la antigüedad: si coincide con la referencia
// (legal-thresholds-reference.ts), no es un error aunque tenga años; si no
// coincide, es un error aunque se haya "confirmado" ayer. Sólo si coincide
// pero nadie lo reconfirmó en 30 días se pide revisar, con severidad menor.
import Decimal from "decimal.js";
import { SALARY_MIN_VES_REFERENCE } from "../legal-thresholds-reference";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface SalMinAlert {
  tieneAviso: boolean;
  titulo: string;
  mensaje: string;
}

/**
 * @param value Valor registrado (string decimal) o `null`/`undefined` si no hay registro.
 * @param lastUpdate ISO de `verifiedAt ?? effectiveFrom`, o `null` si no hay registro.
 * @param now Inyectable para tests; por defecto `Date.now()`.
 */
export function computeSalMinAlert(
  value: string | null | undefined,
  lastUpdate: string | null | undefined,
  now: number = Date.now(),
): SalMinAlert {
  const sinRegistro = value == null;
  const noCoincide = value != null && !new Decimal(value).eq(SALARY_MIN_VES_REFERENCE);
  const necesitaConfirmar = !sinRegistro && !noCoincide && (
    !lastUpdate || (now - new Date(lastUpdate).getTime()) > THIRTY_DAYS_MS
  );

  const tieneAviso = sinRegistro || noCoincide || necesitaConfirmar;

  const titulo = sinRegistro
    ? "Salario mínimo sin registrar"
    : noCoincide
      ? "El salario mínimo registrado no coincide con el vigente"
      : "Confirma que el salario mínimo sigue vigente";

  const salMinFormatted = value != null
    ? `Bs. ${parseFloat(value).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  const lastUpdateFormatted = lastUpdate
    ? new Date(lastUpdate).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
    : null;

  const mensaje = sinRegistro
    ? "No hay registro de salario mínimo vigente para esta empresa."
    : noCoincide
      ? `Tienes registrado ${salMinFormatted}, pero el valor de referencia vigente es ` +
        `Bs. ${SALARY_MIN_VES_REFERENCE.toFixed(2)}. Verifica si salió un decreto nuevo antes de procesar nómina.`
      : `Último registro: ${lastUpdateFormatted} (hace más de 30 días). Valor actual: ` +
        `${salMinFormatted}. Comprueba en MINPPTRASS si hubo un decreto nuevo; si sigue igual, ` +
        "confírmalo en Topes Legales.";

  return { tieneAviso, titulo, mensaje };
}
