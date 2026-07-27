// src/lib/fiscal-provider.ts
// ADR-042 — Re-export fino de `@/lib/countries`.
//
// La interfaz `FiscalProvider` vive en `countries/types.ts` y las
// implementaciones en `countries/<país>/provider.ts`. Este archivo se conserva
// por compatibilidad con los imports existentes.
//
// Uso:
//   const provider = FiscalProviderFactory.forCountry(company.country);

export type { FiscalConfig, FiscalProvider, TaxRates } from "./countries";
export { FiscalProviderFactory, VenezuelaFiscalProvider } from "./countries";
