// src/lib/countries/ven/config.ts
// ADR-042 — Perfil fiscal de Venezuela.
//
// Fuente única de las alícuotas, regex y etiquetas venezolanas. Ningún servicio
// ni componente debe redefinir estos valores: se leen de aquí (directamente si
// el módulo es VEN-only, o vía `getFiscalConfig(country)` si es país-neutral).

import type { FiscalConfig } from "../types";

export const VEN_FISCAL_CONFIG: FiscalConfig = {
  countryCode: "VEN",
  countryName: "Venezuela",

  // ── Moneda y presentación ──
  currency: "VES",
  currencySymbol: "Bs.",
  locale: "es-VE",
  // VEN-NIF: los negativos se muestran entre paréntesis, nunca con guión
  negativeParens: true,

  // ── Identificación tributaria ──
  taxIdLabel: "RIF",
  // RIF: J=Jurídica, V=Natural, E=Extranjero, G=Gobierno, C=Comunal, P=Pasaporte
  // Formato: X-12345678-9 o X-123456789 — el dígito verificador es OBLIGATORIO
  taxIdRegex: /^[JVEGCP]-\d{8}-?\d$/i,
  taxIdPlaceholder: "J-12345678-9",

  // ── Documentos fiscales ──
  taxAuthorityName: "SENIAT",
  // Nº Control — Providencia 0071 Art. 14: XX-XXXXXXXX
  controlNumberRegex: /^\d{2}-\d{8}$/,

  // ── Impuestos ──
  taxRates: {
    ivaGeneral: "0.16", // Art. 27 LIVA
    ivaReduced: "0.08", // Art. 62 LIVA (rubros especiales)
    ivaLuxury: "0.15", // Art. 61 LIVA (bienes suntuarios)
    ivaCombined: "0.31", // 16% + 15% para bienes de lujo
    igtf: "0.03", // Ley IGTF Art. 4
  },

  // Claves = valores del enum Prisma `TaxLineType`
  taxLineRates: {
    IVA_GENERAL: { rate: "0.16", percent: "16", label: "IVA General (16%)" },
    IVA_REDUCIDO: { rate: "0.08", percent: "8", label: "IVA Reducido (8%)" },
    IVA_ADICIONAL: { rate: "0.15", percent: "15", label: "IVA Adicional Lujo (15%)" },
    EXENTO: { rate: "0", percent: "0", label: "Exento (0%)" },
  },
  defaultTaxLineType: "IVA_GENERAL",

  // Venezuela implementa todas las figuras: el filtro por país es la identidad.
  capabilities: {
    igtf: true,
    inflationAdjustment: true,
    ivaRetention: true,
    islrRetention: true,
    ivaDeclaration: true,
    taxAuthorityReporting: true,
    digitalInvoice: true,
    fiscalCalendar: true,
    specialContributor: true,
    taxIdOnlineValidation: true,
    payrollEngine: "VEN",
  },
};
