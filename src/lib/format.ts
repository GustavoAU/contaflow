// Formateador de montos — usa separador de miles y 2 decimales
// Formato: 341.250,00 (es-VE) o 341,250.00 (en-US) según locale del browser

const VE_FORMAT = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: string | number, currency?: "VES" | "USD" | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0,00";
  return currency === "USD" ? USD_FORMAT.format(num) : VE_FORMAT.format(num);
}
