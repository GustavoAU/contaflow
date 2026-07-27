// src/lib/countries/index.ts
// ADR-042 — Registry multi-país: único lugar donde se despacha por país.
//
// Agregar un país = crear `countries/xxx/{config,provider}.ts` y registrarlo en
// FISCAL_CONFIGS + PROVIDERS. Nada más del core cambia.

import type {
  ClientFiscalConfig,
  CountryCode,
  FiscalCapabilities,
  FiscalConfig,
  FiscalProvider,
  TaxLineRateInfo,
  TaxRates,
} from "./types";
import { VEN_FISCAL_CONFIG } from "./ven/config";
import { VenezuelaFiscalProvider } from "./ven/provider";

export type {
  ClientFiscalConfig,
  CountryCode,
  FiscalCapabilities,
  FiscalConfig,
  FiscalProvider,
  TaxLineRateInfo,
  TaxRates,
};
export { VEN_FISCAL_CONFIG, VenezuelaFiscalProvider };

// ── Registry ──────────────────────────────────────────────────────────────────

export const FISCAL_CONFIGS: Record<CountryCode, FiscalConfig> = {
  VEN: VEN_FISCAL_CONFIG,
};

const PROVIDERS: Record<CountryCode, () => FiscalProvider> = {
  VEN: () => new VenezuelaFiscalProvider(),
};

/** Países disponibles para el selector de empresa */
export const SUPPORTED_COUNTRIES: Array<{ code: CountryCode; name: string }> = (
  Object.keys(FISCAL_CONFIGS) as CountryCode[]
).map((code) => ({ code, name: FISCAL_CONFIGS[code].countryName }));

/**
 * Type guard para validar un país que viene de fuera (form, query, BD).
 * Usar SIEMPRE antes de persistir un `Company.country`.
 */
export function isSupportedCountry(value: string): value is CountryCode {
  return Object.prototype.hasOwnProperty.call(FISCAL_CONFIGS, value);
}

// ── Consulta ──────────────────────────────────────────────────────────────────

/**
 * Config fiscal del país dado.
 *
 * LANZA si el país no está soportado. Antes hacía fallback silencioso a
 * Venezuela, lo que en un contexto multi-país significaría cobrar impuestos
 * venezolanos a una empresa extranjera sin que nadie se entere (ADR-042 D-8).
 * Validar en el borde con `isSupportedCountry` si el valor no es de confianza.
 */
export function getFiscalConfig(country: string): FiscalConfig {
  if (!isSupportedCountry(country)) {
    throw new Error(
      `País no soportado: "${country}". Países disponibles: ${Object.keys(FISCAL_CONFIGS).join(", ")}`,
    );
  }
  return FISCAL_CONFIGS[country];
}

/** Atajo de `getFiscalConfig(country).taxRates` */
export function getTaxRates(country: string): TaxRates {
  return getFiscalConfig(country).taxRates;
}

/**
 * Alícuota de línea de factura por clave del enum `TaxLineType`.
 * Lanza si el país no la define — un país sin IVA_ADICIONAL no debe llegar aquí.
 */
export function getTaxLineRate(cfg: FiscalConfig, taxLineType: string): TaxLineRateInfo {
  const info = cfg.taxLineRates[taxLineType];
  if (!info) {
    throw new Error(
      `Alícuota "${taxLineType}" no definida para ${cfg.countryCode}. ` +
        `Disponibles: ${Object.keys(cfg.taxLineRates).join(", ")}`,
    );
  }
  return info;
}

/** ¿El país tiene esta figura fiscal? (ADR-042 D-5) */
export function hasCapability(
  country: string,
  capability: keyof FiscalCapabilities,
): boolean {
  return Boolean(getFiscalConfig(country).capabilities[capability]);
}

// ── Providers ─────────────────────────────────────────────────────────────────

export const FiscalProviderFactory = {
  /** Provider del país dado. Lanza si no está soportado (ver getFiscalConfig). */
  forCountry(country: string): FiscalProvider {
    if (!isSupportedCountry(country)) {
      throw new Error(
        `País no soportado: "${country}". Países disponibles: ${Object.keys(PROVIDERS).join(", ")}`,
      );
    }
    return PROVIDERS[country]();
  },

  /** Atajo para código VEN-only explícito */
  ven(): FiscalProvider {
    return new VenezuelaFiscalProvider();
  },
} as const;

// ── Proyección serializable para el cliente ───────────────────────────────────

/**
 * Convierte `FiscalConfig` en su forma serializable para pasar de un Server
 * Component a uno cliente. Las `RegExp` no cruzan la frontera RSC, así que
 * viajan como string (ADR-042 D-3).
 */
export function toClientFiscalConfig(cfg: FiscalConfig): ClientFiscalConfig {
  return {
    countryCode: cfg.countryCode,
    countryName: cfg.countryName,
    currency: cfg.currency,
    currencySymbol: cfg.currencySymbol,
    locale: cfg.locale,
    negativeParens: cfg.negativeParens,
    taxIdLabel: cfg.taxIdLabel,
    taxIdPattern: cfg.taxIdRegex.source,
    taxIdPlaceholder: cfg.taxIdPlaceholder,
    taxAuthorityName: cfg.taxAuthorityName,
    controlNumberPattern: cfg.controlNumberRegex?.source,
    taxRates: cfg.taxRates,
    taxLineRates: cfg.taxLineRates,
    defaultTaxLineType: cfg.defaultTaxLineType,
    capabilities: cfg.capabilities,
  };
}

// ── Memoización ───────────────────────────────────────────────────────────────

/**
 * Envuelve un builder caro (típicamente una factory de schemas Zod) para que se
 * ejecute UNA vez por país en la vida del proceso (ADR-042 D-1).
 *
 *   const getInvoiceSchemas = memoizePerCountry((cfg) => ({ create: build(cfg) }));
 *   getInvoiceSchemas(cfg)  // mismo objeto en llamadas sucesivas
 */
export function memoizePerCountry<T>(
  build: (cfg: FiscalConfig) => T,
): (cfg: FiscalConfig) => T {
  const cache = new Map<CountryCode, T>();
  return (cfg: FiscalConfig): T => {
    const cached = cache.get(cfg.countryCode);
    if (cached !== undefined) return cached;
    const built = build(cfg);
    cache.set(cfg.countryCode, built);
    return built;
  };
}
