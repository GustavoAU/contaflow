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

// ── Normalización del RIF (MEDIUM-2, auditoría de seguridad MP-1) ────────────
//
// El `@unique` de Postgres compara strings crudos, así que "J-12345678-9",
// "j-123456789" y "J 12345678 9" convivían como tres empresas distintas con la
// MISMA identidad fiscal. En `ManagedClient` el efecto era peor: cada variante
// consumía un cupo del tier que el despacho paga.
//
// La solución es una forma canónica ÚNICA que se guarda en BD; así el `@unique`
// existente vuelve a significar lo que promete, sin índices funcionales ni
// columnas espejo que mantener en sincronía.
//
// NO unifica deliberadamente el RIF legacy sin dígito verificador ("J-12345678")
// con el completo ("J-12345678-9"): son identificadores distintos y decidir que
// uno "es" el otro requiere inventar el dígito. Ver `assertRifEditable` para el
// grandfathering de esos valores heredados.
const RIF_CANONICAL = /^([JVEGCP])(\d+)$/;

/**
 * Forma canónica de un RIF: mayúsculas y separadores normalizados.
 *
 *   "j-123456789"  → "J-12345678-9"
 *   "J 12345678 9" → "J-12345678-9"
 *   "J-12345678"   → "J-12345678"    (legacy sin verificador, se respeta)
 *
 * Si el valor no tiene forma de RIF se devuelve recortado y en mayúsculas, sin
 * inventarle estructura — validar el formato es tarea de `taxIdRegex`.
 */
export function normalizeRif(raw: string): string {
  const trimmed = raw.trim();
  const compact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = RIF_CANONICAL.exec(compact);
  if (!match) return trimmed.toUpperCase();

  const [, letter, digits] = match;
  // 9 dígitos = 8 de cédula/registro + verificador
  if (digits.length === 9) return `${letter}-${digits.slice(0, 8)}-${digits[8]}`;
  return `${letter}-${digits}`;
}

/** Igual que `normalizeRif` pero tolerando null/undefined/"" → null. */
export function normalizeRifOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = normalizeRif(raw);
  return normalized === "" ? null : normalized;
}
