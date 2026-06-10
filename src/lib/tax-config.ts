// src/lib/tax-config.ts
// Q3-5: Arquitectura Multi-País — fuente de verdad para configuración fiscal por país.
//
// DISEÑO: Toda la config fiscal vive aquí — alícuotas IVA, IGTF, regex de ID tributario,
// moneda, etc. Los servicios y schemas deben importar FISCAL_CONFIGS en lugar de
// hardcodear valores numéricos como "0.16".
//
// YAGNI: Solo Venezuela está implementado. La interfaz está lista para Colombia/Argentina
// cuando haya un contrato firmado (ver CLAUDE.md — contaflow-contract.md).
//
// Uso:
//   import { getFiscalConfig, VEN_FISCAL_CONFIG } from "@/lib/tax-config";
//   const cfg = getFiscalConfig(company.country);  // para código multi-país
//   const cfg = VEN_FISCAL_CONFIG;                 // para código VEN-only explícito

// ── Tipos ─────────────────────────────────────────────────────────────────────

/**
 * Códigos de país soportados (ISO 3166-1 alpha-3).
 * Extensible: agregar "COL" | "ARG" | "PAN" cuando haya contrato.
 */
export type CountryCode = "VEN";

/**
 * Alícuotas impositivas del país.
 * Todos los valores son strings de precisión decimal (R-5: no float).
 */
export type TaxRates = {
  /** Alícuota IVA general (VEN: "0.16" = 16%) */
  ivaGeneral: string;
  /** Alícuota IVA reducida para rubros especiales (VEN: "0.08" = 8%) */
  ivaReduced: string;
  /** Alícuota IVA adicional de bienes de lujo (VEN: "0.15" = 15%) */
  ivaLuxury: string;
  /**
   * Total combinado para bienes de lujo = general + luxury.
   * Calculado una vez aquí para no recomputar en servicios.
   */
  ivaCombined: string;
  /** IGTF — Impuesto a Grandes Transacciones Financieras (VEN: "0.03" = 3%) */
  igtf: string;
};

/**
 * Configuración fiscal completa por país.
 * Agrupa reglas de identificación tributaria, moneda y alícuotas.
 */
export type FiscalConfig = {
  countryCode:            CountryCode;
  countryName:            string;
  /** Moneda funcional (ISO 4217) */
  currency:               string;
  /** Etiqueta del ID tributario en la UI ("RIF" para VEN, "NIT" para COL, etc.) */
  taxIdLabel:             string;
  /** Regex de validación del ID tributario — para Zod .refine() */
  taxIdRegex:             RegExp;
  /** Ejemplo de ID tributario para placeholder en formularios */
  taxIdPlaceholder:       string;
  /** Regex de número de control de documentos fiscales (SENIAT PA-071 para VEN) */
  controlNumberRegex?:    RegExp;
  taxRates:               TaxRates;
};

// ── Configuraciones por país ──────────────────────────────────────────────────

export const FISCAL_CONFIGS: Record<CountryCode, FiscalConfig> = {
  VEN: {
    countryCode:       "VEN",
    countryName:       "Venezuela",
    currency:          "VES",
    taxIdLabel:        "RIF",
    // RIF venezolano: J=Jurídica, V=Natural, E=Extranjero, G=Gobierno, C=Comunal, P=Pasaporte
    // Formato: X-12345678-9 o X-123456789 (con o sin guión verificador)
    taxIdRegex:        /^[JVEGCP]-\d{8}-?\d$/i,
    taxIdPlaceholder:  "J-12345678-9",
    // Nº Control SENIAT — Providencia 0071 Art. 14: XX-XXXXXXXX
    controlNumberRegex: /^\d{2}-\d{8}$/,
    taxRates: {
      ivaGeneral:  "0.16",   // 16% — Art. 27 LIVA
      ivaReduced:  "0.08",   // 8%  — Art. 62 LIVA (rubros especiales)
      ivaLuxury:   "0.15",   // 15% adicional — Art. 61 LIVA (bienes suntuarios)
      ivaCombined: "0.31",   // 31% = 16% + 15% para bienes de lujo
      igtf:        "0.03",   // 3%  — Ley IGTF Art. 4
    },
  },
};

// ── Funciones de consulta ─────────────────────────────────────────────────────

/**
 * Retorna la FiscalConfig para el país dado.
 * Si el país no está implementado, hace fallback a VEN (única opción actual).
 * Esto permite código multi-país genérico sin romper nada en producción.
 */
export function getFiscalConfig(country: string): FiscalConfig {
  const config = FISCAL_CONFIGS[country as CountryCode];
  // Fallback defensivo: VEN es el único país soportado por ahora
  return config ?? FISCAL_CONFIGS.VEN;
}

/**
 * Retorna las alícuotas del país dado.
 * Convenience wrapper — evita repetir `getFiscalConfig(c).taxRates`.
 */
export function getTaxRates(country: string): TaxRates {
  return getFiscalConfig(country).taxRates;
}

/**
 * Lista de países disponibles para el selector de empresa.
 * Amplíar cuando se agregue soporte a nuevos países.
 */
export const SUPPORTED_COUNTRIES: Array<{ code: CountryCode; name: string }> = [
  { code: "VEN", name: "Venezuela" },
];

// ── Re-exports para compatibilidad con código VEN-only existente ──────────────
// Permite migración gradual: módulos que solo manejan VEN pueden usar estas
// constantes directamente en lugar de llamar getFiscalConfig().

/** Config fiscal completa para Venezuela — atajo para código VEN-only */
export const VEN_FISCAL_CONFIG    = FISCAL_CONFIGS.VEN;

/** Regex del RIF venezolano — re-export para `fiscal-validators.ts` */
export const VEN_RIF_REGEX        = FISCAL_CONFIGS.VEN.taxIdRegex;

/** Alícuotas impositivas venezolanas — úsalas en servicios para evitar "0.16" hardcodeado */
export const VEN_TAX_RATES        = FISCAL_CONFIGS.VEN.taxRates;

/** Regex Nº Control SENIAT */
export const VEN_CONTROL_NUMBER_REGEX = FISCAL_CONFIGS.VEN.controlNumberRegex!;

// ── Monedas ───────────────────────────────────────────────────────────────────

/**
 * Monedas soportadas (ISO 4217) — fuente única de verdad para z.enum en schemas.
 * Agregar aquí cuando se soporte una nueva moneda funcional.
 */
export const SUPPORTED_CURRENCIES = ["VES", "USD", "EUR"] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];
