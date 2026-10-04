// src/lib/money-input.ts
// Entrada de importes escritos a mano (convención es-VE: coma decimal, punto de miles).
// Todo con Decimal.js (R-5): nunca number/parseFloat sobre dinero.
import Decimal from "decimal.js";

/**
 * Convierte lo que escribió el usuario a la forma canónica "1234.56" (punto decimal,
 * sin miles), segura para `new Decimal(...)` y para el servidor. Devuelve "" si está
 * vacío o no hay ningún dígito.
 *
 * `allowNegative` admite un "-" inicial (saldos bancarios); `decimals` (def. 2) recorta.
 *
 * Reglas:
 *   - Una coma al final del número: es el decimal y los puntos son miles ("1.234,56", "100,99").
 *   - Ambos separadores y el punto va último ("1,234.56"): el punto es el decimal.
 *   - Varios separadores iguales → miles ("1.234.567", "1,234,567").
 *   - Sin coma, un solo punto: miles si le siguen exactamente 3 dígitos ("20.000"),
 *     decimal en caso contrario ("100.99", costumbre americana).
 */
export function normalizeMoneyInput(
  text: string,
  { decimals = 2, allowNegative = false }: { decimals?: number; allowNegative?: boolean } = {}
): string {
  const negative = allowNegative && /^\s*-/.test(text);
  const s = text.replace(/[^0-9.,]/g, "");
  if (!/\d/.test(s)) return "";

  let intPart: string;
  let decPart = "";

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const commas = s.split(",").length - 1;
  if (lastComma >= 0 && lastComma > lastDot && commas === 1) {
    // Coma decimal es-VE ("1.234,56", "100,99"): los puntos son miles.
    intPart = s.slice(0, lastComma).replace(/[.,]/g, "");
    decPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0 && lastDot > lastComma && s.split(".").length === 2 && lastComma >= 0) {
    // Ambos presentes y el punto va al final ("1,234.56"): punto decimal.
    intPart = s.slice(0, lastDot).replace(/[.,]/g, "");
    decPart = s.slice(lastDot + 1);
  } else if (lastComma >= 0 && commas > 1) {
    // Varias comas sin punto decimal: miles ("1,234,567").
    intPart = s.replace(/[.,]/g, "");
  } else {
    const dots = s.split(".");
    if (dots.length === 2 && dots[1].length !== 3) {
      intPart = dots[0];
      decPart = dots[1];
    } else {
      intPart = dots.join("");
    }
  }

  intPart = intPart.replace(/^0+(?=\d)/, "") || "0";
  // Más decimales de los permitidos se descartan al teclear (nunca se redondea en silencio).
  decPart = decPart.slice(0, decimals);
  const out = decPart ? `${intPart}.${decPart}` : intPart;
  return negative && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Decimal de un valor canónico; "" (o basura) → 0. Nunca lanza. */
export function parseMoneyInput(canonical: string): Decimal {
  try {
    return canonical ? new Decimal(canonical) : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** "1234567.5" → "1.234.567,50" (punto de miles, coma decimal; `decimals` por defecto 2). */
export function formatMoneyVE(value: Decimal.Value, decimals = 2): string {
  const d = new Decimal(value).toDecimalPlaces(decimals);
  const [int, dec] = d.abs().toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${d.isNegative() && !d.isZero() ? "-" : ""}${grouped}${dec ? `,${dec}` : ""}`;
}
