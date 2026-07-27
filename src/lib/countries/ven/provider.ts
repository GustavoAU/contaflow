// src/lib/countries/ven/provider.ts
// ADR-042 — FiscalProvider de Venezuela.

import type { FiscalConfig, FiscalProvider, TaxRates } from "../types";
import { VEN_FISCAL_CONFIG } from "./config";

export class VenezuelaFiscalProvider implements FiscalProvider {
  private readonly config: FiscalConfig = VEN_FISCAL_CONFIG;

  get countryCode() {
    return this.config.countryCode;
  }
  get countryName() {
    return this.config.countryName;
  }
  get currency() {
    return this.config.currency;
  }
  get taxIdLabel() {
    return this.config.taxIdLabel;
  }

  validateTaxId(rif: string): boolean {
    return this.config.taxIdRegex.test(rif);
  }

  /** Normaliza a mayúsculas y sin espacios (no altera la forma del guión) */
  formatTaxId(rif: string): string {
    return rif.toUpperCase().replace(/\s/g, "");
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
