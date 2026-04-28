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

/**
 * Normaliza un string numérico en cualquier formato regional a un número JS.
 *
 * Soporta:
 *   Europeo/VE  → "1.234.567,89"  (punto=miles, coma=decimal)
 *   Americano   → "1,234,567.89"  (coma=miles, punto=decimal)
 *   Sin miles   → "1234,89" / "1234.89"
 *
 * Regla de desambiguación cuando hay un solo separador:
 *   - Si hay exactamente un punto Y la parte tras él tiene 3 dígitos → miles (ej: "1.234" → 1234)
 *   - Si hay exactamente una coma Y la parte tras ella tiene 1-2 dígitos → decimal (ej: "1,50" → 1.50)
 *   - En caso contrario → parseFloat estándar
 *
 * Usar SIEMPRE esta función en OCR/importaciones; nunca parseFloat directo sobre texto del usuario.
 */
export function fmtDate(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d as string);
  return new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()).toLocaleDateString("es-VE");
}

export function parseLocalNumber(value: string): number {
  const s = value.trim().replace(/\s/g, "");
  if (!s) return NaN;

  const hasDot   = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // Ambos presentes: el último determina el decimal
    const lastDot   = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Europeo: 1.234,56
      return parseFloat(s.replace(/\./g, "").replace(",", "."));
    } else {
      // Americano: 1,234.56
      return parseFloat(s.replace(/,/g, ""));
    }
  }

  if (hasComma && !hasDot) {
    const parts = s.split(",");
    // Si hay múltiples comas → miles americano (1,234,567)
    if (parts.length > 2) return parseFloat(s.replace(/,/g, ""));
    // Una sola coma: decimal europeo si ≤2 dígitos tras la coma; miles si 3
    const afterComma = parts[parts.length - 1];
    if (afterComma.length === 3) return parseFloat(s.replace(/,/g, "")); // miles
    return parseFloat(s.replace(",", ".")); // decimal
  }

  if (hasDot && !hasComma) {
    const parts = s.split(".");
    // Múltiples puntos → miles europeo (1.234.567)
    if (parts.length > 2) return parseFloat(s.replace(/\./g, ""));
    // Un solo punto: miles si 3 dígitos tras él; decimal en caso contrario
    const afterDot = parts[parts.length - 1];
    if (afterDot.length === 3) return parseFloat(s.replace(/\./g, "")); // miles VE
    return parseFloat(s); // decimal americano
  }

  return parseFloat(s);
}
