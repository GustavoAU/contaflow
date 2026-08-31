// src/modules/payroll/utils/payroll-gl-accounts.ts
//
// Qué cuentas contables de nómina pueden compartirse y cuáles no.
//
// La regla NO es "las dieciséis distintas". Lo que no puede mezclarse son
// ACREEDORES distintos: el IVSS y el Banavih son dos institutos que cobran por
// separado, y meter los dos en la misma cuenta hace imposible cuadrar lo que le
// debes a cada uno.
//
// En cambio la retención del trabajador y el aporte del patrono del MISMO
// organismo se enteran en la misma planilla, así que una sola cuenta
// "IVSS por Pagar" para ambas es práctica corriente y perfectamente auditable.
//
// Exigirlas todas separadas obligaba a inventar cuentas que el plan no tiene
// —siete, en una empresa real— y empujaba justo al error que la validación
// quiere evitar: reutilizar la de OTRO organismo porque no queda otra.
// Separarlas sigue siendo válido para quien quiera más granularidad.

/** Campos de cuenta GL de la configuración de nómina, con su acreedor. Dos
 *  campos del mismo `grupo` pueden compartir cuenta; de grupos distintos, no. */
export const GL_ACCOUNT_FIELDS = [
  { key: "expenseAccountId",              label: "Gasto Sueldos y Salarios",   grupo: "gasto-sueldos" },
  { key: "payableAccountId",              label: "Sueldos por Pagar",          grupo: "sueldos-netos" },
  { key: "ivssPayableAccountId",          label: "IVSS Obrero por Pagar",      grupo: "ivss" },
  { key: "ivssPatronalAccountId",         label: "IVSS Patronal por Pagar",    grupo: "ivss" },
  { key: "incesPayableAccountId",         label: "INCES Obrero por Pagar",     grupo: "inces" },
  { key: "incesPatronalAccountId",        label: "INCES Patronal por Pagar",   grupo: "inces" },
  { key: "faovPayableAccountId",          label: "FAOV Obrero por Pagar",      grupo: "faov" },
  { key: "faovPatronalAccountId",         label: "FAOV Patronal por Pagar",    grupo: "faov" },
  { key: "rpePayableAccountId",           label: "RPE Obrero por Pagar",       grupo: "rpe" },
  { key: "rpePatronalAccountId",          label: "RPE Patronal por Pagar",     grupo: "rpe" },
  { key: "benefitsExpenseAccountId",      label: "Gasto Prestaciones",         grupo: "gasto-prestaciones" },
  { key: "benefitsPayableAccountId",      label: "Prestaciones por Pagar",     grupo: "prestaciones" },
  { key: "vacationPayableAccountId",      label: "Vacaciones por Pagar",       grupo: "vacaciones" },
  { key: "profitSharingPayableAccountId", label: "Utilidades por Pagar",       grupo: "utilidades" },
  { key: "loanReceivableAccountId",       label: "Préstamos a Empleados",      grupo: "prestamos" },
  { key: "disbursementBankAccountId",     label: "Banco de Desembolso",        grupo: "banco" },
] as const;

export type GlAccountKey = (typeof GL_ACCOUNT_FIELDS)[number]["key"];

/**
 * Mensaje del primer choque real, o `null` si la asignación es válida.
 * Los campos vacíos se ignoran: "sin asignar" no choca con nada.
 */
export function detectAccountConflict(
  form: Partial<Record<GlAccountKey, string>>,
): string | null {
  const seen = new Map<string, { label: string; grupo: string }>();
  for (const { key, label, grupo } of GL_ACCOUNT_FIELDS) {
    const id = form[key];
    if (!id) continue;
    const previo = seen.get(id);
    if (previo && previo.grupo !== grupo) {
      return `"${previo.label}" y "${label}" usan la misma cuenta GL`;
    }
    if (!previo) seen.set(id, { label, grupo });
  }
  return null;
}
