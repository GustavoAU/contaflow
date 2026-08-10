// src/lib/tax-config.ts
// ADR-042 — Re-export fino de `@/lib/countries`.
//
// La configuración fiscal vive ahora en `src/lib/countries/` (registry + una
// carpeta por país). Este archivo se conserva para no romper los ~30 módulos
// que ya importaban de aquí, y como hogar de los alias VEN-only.
//
// ¿Qué usar en código nuevo?
//   - Módulo país-neutral  → `getFiscalConfig(ctx.country)` de "@/lib/countries"
//   - Módulo 100% VEN      → los alias `VEN_*` de este archivo
//
// El test de arquitectura `country-coupling` (MP-3) vigila que los módulos
// país-neutrales no usen los alias VEN.

export type {
  ClientFiscalConfig,
  CountryCode,
  FiscalCapabilities,
  FiscalConfig,
  FiscalProvider,
  TaxLineRateInfo,
  TaxRates,
} from "./countries";

export {
  FISCAL_CONFIGS,
  FiscalProviderFactory,
  SUPPORTED_COUNTRIES,
  VEN_FISCAL_CONFIG,
  VenezuelaFiscalProvider,
  getFiscalConfig,
  getTaxLineRate,
  getTaxRates,
  hasCapability,
  isSupportedCountry,
  memoizePerCountry,
  toClientFiscalConfig,
} from "./countries";

import { VEN_FISCAL_CONFIG } from "./countries";

// ── Alias VEN-only ────────────────────────────────────────────────────────────
// Para módulos que solo existen en Venezuela (retenciones, IGTF, declaración
// IVA, INPC, SENIAT, despacho). En módulos país-neutrales usar getFiscalConfig.

/** Regex del RIF venezolano — dígito verificador obligatorio */
export const VEN_RIF_REGEX = VEN_FISCAL_CONFIG.taxIdRegex;

/**
 * Normalización del RIF a su forma canónica. OBLIGATORIO antes de persistir o de
 * comparar un RIF: sin esto el `@unique` de Postgres deja pasar la misma identidad
 * fiscal escrita distinto (MEDIUM-2).
 */
export { normalizeRif, normalizeRifOrNull } from "./countries/ven/config";

/** Alícuotas venezolanas — evita "0.16" hardcodeado en servicios */
export const VEN_TAX_RATES = VEN_FISCAL_CONFIG.taxRates;

/** Regex del Nº Control SENIAT (Providencia 0071 Art. 14) */
export const VEN_CONTROL_NUMBER_REGEX = VEN_FISCAL_CONFIG.controlNumberRegex!;

// ── Monedas ───────────────────────────────────────────────────────────────────

/**
 * Monedas soportadas (ISO 4217) — fuente única para los `z.enum` de schemas.
 * Al agregar un país con moneda propia: añadir aquí y agregar el valor al enum
 * Prisma `Currency` con `ALTER TYPE` (ADR-042 D-12).
 */
export const SUPPORTED_CURRENCIES = ["VES", "USD", "EUR"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
