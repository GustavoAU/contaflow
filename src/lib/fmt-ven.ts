/**
 * Formateo de cifras monetarias conforme a VEN-NIF.
 * Valores negativos → (1.234.567,89)   ← paréntesis, nunca guión.
 * Valores positivos → 1.234.567,89
 */

function _fmt(n: number, decimals: number): string {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(abs);
  return n < 0 ? `(${s})` : s;
}

/** Número solo: sin prefijo de moneda.  Ej.: "1.234.567,89" o "(1.234.567,89)" */
export function fmtVen(
  value: string | number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return "—";
  return _fmt(n, decimals);
}

/** Con prefijo Bs.: "Bs. 1.234.567,89" o "Bs. (1.234.567,89)" */
export function fmtBs(
  value: string | number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return "—";
  const s = _fmt(n, decimals);
  return `Bs. ${s}`;
}
