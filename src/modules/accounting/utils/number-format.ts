// src/modules/accounting/utils/number-format.ts
//
// Helpers de formato numérico para reportes financieros venezolanos.
// Usan la localización "es-VE" para separadores de miles y decimales.

// Formatea un valor decimal como número legible con 2 decimales.
// Ej: "1234567.89" → "1.234.567,89"
export function fmt(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// Formatea un valor con notación contable: valores negativos van entre paréntesis.
// Ej: "-1234.56" → "(1.234,56)"  |  "1234.56" → "1.234,56"
// Convención estándar en estados financieros VEN-NIF para créditos y deducciones.
export function fmtAccounting(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  const abs = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));
  return num < 0 ? `(${abs})` : abs;
}
