// src/lib/zod-helpers.ts
import { z } from "zod";
import { Decimal } from "decimal.js";

const MAX_MONEY = new Decimal("999999999.99");

function isValidMoney(v: string, positive = false): boolean {
  try {
    const d = new Decimal(v);
    if (!d.isFinite()) return false;
    if (d.decimalPlaces() > 2) return false;
    if (d.gt(MAX_MONEY)) return false;
    return positive ? d.gt(0) : d.gte(0);
  } catch {
    return false;
  }
}

/**
 * Schema Zod para montos monetarios (Bs./USD/EUR).
 * Acepta string o number; valida que sea ≥ 0, máximo 2 decimales, máximo 999,999,999.99.
 * Evita que NaN, Infinity o valores con más de 2 decimales lleguen a Prisma Decimal(20,2).
 */
export const zMoneyAmount = z.coerce
  .string()
  .refine((v) => isValidMoney(v), {
    error: "Monto inválido: debe ser ≥ 0 con máximo 2 decimales",
  });

/**
 * Igual que zMoneyAmount pero exige valor > 0.
 */
export const zMoneyPositive = z.coerce
  .string()
  .refine((v) => isValidMoney(v, true), {
    error: "El monto debe ser mayor a cero con máximo 2 decimales",
  });

/**
 * Schema para tasas de cambio (BCV, etc.).
 * Acepta hasta 4 decimales — las tasas BCV se publican con 4 dígitos significativos.
 * Ej: 549.3716 es válido; zMoneyAmount lo rechazaría por superar 2 decimales.
 */
export const zExchangeRate = z.coerce
  .string()
  .refine(
    (v) => {
      try {
        const d = new Decimal(v);
        return d.isFinite() && d.gt(0) && d.decimalPlaces() <= 4 && d.lte(new Decimal("9999999.9999"));
      } catch {
        return false;
      }
    },
    { error: "Tasa de cambio inválida: debe ser > 0 con máximo 4 decimales" }
  );

/**
 * Texto opcional de formulario: "" (campo vacío) → null — Prisma LIMPIA la columna;
 * undefined (campo ausente en un update parcial) se preserva — Prisma NO la toca.
 *
 * Reemplaza el patrón roto `.optional().or(z.literal("").transform(() => undefined))`:
 * su branch `.or` era código MUERTO cuando "" ya pasaba la validación previa
 * (phone/code/notes/address llegaban como "" a la BD), y en los campos validados
 * (rif/email) producía undefined en updates → el campo era IMBORRABLE (Prisma omite
 * undefined). Con "" en columnas @unique (Vendor.rif/code por empresa) además
 * provocaba P2002 al segundo registro vacío.
 */
export const zOptionalText = (max: number, msg?: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .nullable()
    .transform((v) => (v === "" ? null : v))
    // .optional() al FINAL: mantiene la key opcional en el objeto (un .transform
    // terminal la volvería requerida en el tipo inferido)
    .optional();

/**
 * Variante para campos opcionales CON validación de formato (regex/email/cuid):
 * "" salta la validación y se vuelve null; un valor no vacío se valida normal.
 */
export function zEmptyAsNull<T extends z.ZodType<string>>(validated: T) {
  return z.union([z.literal("").transform(() => null), validated]).nullish();
}

// ─── Fechas de negocio con rango acotado ──────────────────────────────────────
// Auditoría Compras/Ventas 2026-07 (H-1/H-2): un typo de año ("12026") pasaba
// `Date.parse`/`z.coerce.date()` (JS acepta años hasta 275760), se persistía, y al
// releerse desde Neon producía un Invalid Date cuyo `.toISOString()` lanzaba
// RangeError — tumbando el listado COMPLETO del módulo para toda la empresa.
// Toda fecha ingresada por el usuario debe validarse con estos helpers, nunca con
// `z.coerce.date()` ni `Date.parse` a secas.

const MIN_BUSINESS_DATE = Date.UTC(1900, 0, 1);
const MAX_BUSINESS_DATE = Date.UTC(2100, 11, 31, 23, 59, 59, 999);

function inBusinessRange(d: Date): boolean {
  const t = d.getTime();
  return !Number.isNaN(t) && t >= MIN_BUSINESS_DATE && t <= MAX_BUSINESS_DATE;
}

/**
 * Fecha coercida (output `Date`) con rango [1900, 2100].
 * Reemplazo directo de `z.coerce.date()` para input de usuario.
 */
export function zBusinessDate(opts?: { error?: string }) {
  return z.coerce
    .date(opts?.error ? { error: opts.error } : undefined)
    .refine(inBusinessRange, { error: "Fecha fuera del rango permitido (1900–2100)" });
}

/**
 * Fecha como string (output `string`, sin transformar) con rango [1900, 2100].
 * Reemplazo directo del patrón `z.string().refine((v) => !isNaN(Date.parse(v)))`.
 * Rechaza "" — para campos opcionales que aceptan vacío, componer con
 * `.or(z.literal("")).optional()` en el call site.
 */
export const zBusinessDateString = z
  .string()
  .refine((v) => inBusinessRange(new Date(v)), {
    error: "Fecha inválida o fuera del rango permitido (1900–2100)",
  });
