// src/lib/fiscal-provider.ts
// Q3-5: Arquitectura Multi-País — interfaz FiscalProvider.
//
// Un FiscalProvider encapsula toda la lógica fiscal específica de un país.
// Los servicios que hoy tienen lógica VEN-only (InvoiceLineService, FiscalCalculator,
// SeniatReportingService, etc.) eventualmente recibirán un FiscalProvider inyectado
// para soportar múltiples jurisdicciones sin modificar su lógica interna.
//
// ESTADO ACTUAL: Solo VEN implementado (VenezuelaFiscalProvider).
// EXTENSIÓN: Cuando se firme contrato Colombia, crear ColombiaFiscalProvider
// e inyectarlo en los servicios afectados.
//
// Patrón de uso (futuro):
//   const provider = FiscalProviderFactory.forCompany(company.country);
//   const iva = provider.calculateIva(base, "GENERAL");

import type { FiscalConfig, TaxRates } from "./tax-config";
import { getFiscalConfig } from "./tax-config";

// ── Interfaz ──────────────────────────────────────────────────────────────────

export interface FiscalProvider {
  /** ISO 3166-1 alpha-3 */
  readonly countryCode: string;
  /** Human-readable country name */
  readonly countryName: string;
  /** ISO 4217 currency code */
  readonly currency: string;
  /** Label for the tax ID field in the UI */
  readonly taxIdLabel: string;

  /** Validate a tax identifier (RIF, NIT, etc.) */
  validateTaxId(taxId: string): boolean;

  /** Format a tax ID for human-readable display */
  formatTaxId(taxId: string): string;

  /** Validate a fiscal control number (SENIAT Nº Control, etc.) */
  validateControlNumber?(controlNumber: string): boolean;

  /** Tax rates for this jurisdiction */
  getTaxRates(): TaxRates;

  /** Full fiscal configuration */
  getFiscalConfig(): FiscalConfig;
}

// ── VenezuelaFiscalProvider ───────────────────────────────────────────────────

export class VenezuelaFiscalProvider implements FiscalProvider {
  private readonly config: FiscalConfig;

  constructor() {
    this.config = getFiscalConfig("VEN");
  }

  get countryCode() { return this.config.countryCode; }
  get countryName() { return this.config.countryName; }
  get currency()    { return this.config.currency; }
  get taxIdLabel()  { return this.config.taxIdLabel; }

  validateTaxId(rif: string): boolean {
    return this.config.taxIdRegex.test(rif);
  }

  formatTaxId(rif: string): string {
    // Normalize to uppercase and ensure hyphen format
    const upper = rif.toUpperCase().replace(/\s/g, "");
    // Already in correct format — just uppercase
    return upper;
  }

  validateControlNumber(controlNumber: string): boolean {
    return this.config.controlNumberRegex?.test(controlNumber) ?? true;
  }

  getTaxRates(): TaxRates {
    return this.config.taxRates;
  }

  getFiscalConfig(): FiscalConfig {
    return this.config;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Factory que retorna el FiscalProvider correcto para un país dado.
 *
 * Uso en servicios:
 *   const provider = FiscalProviderFactory.forCountry(company.country);
 *
 * Uso legacy (código VEN-only):
 *   const provider = FiscalProviderFactory.ven();
 */
export const FiscalProviderFactory = {
  forCountry(country: string): FiscalProvider {
    // Solo VEN implementado — fallback defensivo a VEN para otros
    switch (country) {
      case "VEN":
      default:
        return new VenezuelaFiscalProvider();
    }
  },

  /** Convenience: retorna el provider de Venezuela directamente */
  ven(): FiscalProvider {
    return new VenezuelaFiscalProvider();
  },
} as const;
