// src/lib/islr-suggestions.ts
// Asistente ISLR — Fase 12C
//
// Sugerencia automática de código y alícuota ISLR basada en palabras clave
// del concepto de la factura. Pure client-side — sin server calls, sin Decimal.
// Fuente legal: Decreto 1808 SENIAT (Retenciones ISLR Venezuela).

export interface IslrSuggestion {
  /** Código que coincide con una clave de ISLR_RATES en retention.schema.ts */
  code: string;
  rate: number;
  label: string;
  /** Referencia legal para mostrar en tooltip */
  legalRef: string;
}

// ─── Mapa de palabras clave → sugerencia ─────────────────────────────────────
// Clave: palabra en minúsculas sin tildes (normalizada con NFD)
// Se busca coincidencia exacta primero, luego substring.

const MAP: Record<string, IslrSuggestion> = {
  // ── Honorarios profesionales (5%) ─────────────────────────────────────────
  honorario:    { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  honorarios:   { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  "honorario profesional": { code: "HONORARIOS_PN", rate: 5, label: "Honorarios Profesionales PN", legalRef: "Decreto 1808, Num. 11" },
  abogado:      { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  abogados:     { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  medico:       { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  medicos:      { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  contador:     { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  auditoria:    { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },
  peritaje:     { code: "HONORARIOS_PN", rate: 5,  label: "Honorarios Profesionales PN",  legalRef: "Decreto 1808, Num. 11" },

  // ── Comisiones y corretaje (3%) ────────────────────────────────────────────
  comision:     { code: "COMISIONES_PJ", rate: 3,  label: "Comisiones y Corretaje PJ",    legalRef: "Decreto 1808, Num. 6"  },
  comisiones:   { code: "COMISIONES_PJ", rate: 3,  label: "Comisiones y Corretaje PJ",    legalRef: "Decreto 1808, Num. 6"  },
  corretaje:    { code: "COMISIONES_PJ", rate: 3,  label: "Comisiones y Corretaje PJ",    legalRef: "Decreto 1808, Num. 6"  },
  agencia:      { code: "COMISIONES_PJ", rate: 3,  label: "Comisiones y Corretaje PJ",    legalRef: "Decreto 1808, Num. 6"  },
  agente:       { code: "COMISIONES_PJ", rate: 3,  label: "Comisiones y Corretaje PJ",    legalRef: "Decreto 1808, Num. 6"  },

  // ── Arrendamiento (5%) ─────────────────────────────────────────────────────
  arrendamiento:{ code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  alquiler:     { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  alquileres:   { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  canon:        { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  renta:        { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  galpón:       { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },
  galpon:       { code: "ARRENDAMIENTO_PJ", rate: 5, label: "Arrendamiento PJ",           legalRef: "Decreto 1808, Num. 8"  },

  // ── Fletes y transporte (1%) ───────────────────────────────────────────────
  flete:        { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  fletes:       { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  transporte:   { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  transportacion:{ code: "FLETES_PJ",     rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  courier:      { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  envio:        { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  envios:       { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  carga:        { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },
  despacho:     { code: "FLETES_PJ",      rate: 1,  label: "Fletes y Transporte PJ",      legalRef: "Decreto 1808, Num. 9"  },

  // ── Publicidad y propaganda (3%) ───────────────────────────────────────────
  publicidad:   { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  propaganda:   { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  marketing:    { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  pauta:        { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  anuncio:      { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  diseño:       { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },
  diseno:       { code: "PUBLICIDAD_PJ",  rate: 3,  label: "Publicidad y Propaganda PJ",  legalRef: "Decreto 1808, Num. 11" },

  // ── Construcción y obras (2%) ──────────────────────────────────────────────
  construccion: { code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  obra:         { code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  obras:        { code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  remodelacion: { code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  remodelaciones:{ code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",    legalRef: "Decreto 1808, Num. 14" },
  instalacion:  { code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  instalaciones:{ code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },
  mantenimiento:{ code: "CONSTRUCCION_PJ", rate: 2, label: "Construcción y Obras PJ",     legalRef: "Decreto 1808, Num. 14" },

  // ── Consultoría / servicios técnicos (2% PJ default) ──────────────────────
  consultoria:  { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  consultoras:  { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  asesoria:     { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  asesorias:    { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  servicio:     { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  servicios:    { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  soporte:      { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  mantencion:   { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  tecnologia:   { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  informatica:  { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  sistemas:     { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  software:     { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  capacitacion: { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  capacitaciones:{ code: "SERVICIOS_PJ",  rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  adiestramiento:{ code: "SERVICIOS_PJ",  rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  formacion:    { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  limpieza:     { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  vigilancia:   { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  seguridad:    { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },
  contabilidad: { code: "SERVICIOS_PJ",   rate: 2,  label: "Servicios PJ",                legalRef: "Decreto 1808, Num. 4"  },

  // ── Intereses (3%) ────────────────────────────────────────────────────────
  interes:      { code: "INTERESES_PJ",   rate: 3,  label: "Intereses PJ",                legalRef: "Decreto 1808, Num. 7"  },
  intereses:    { code: "INTERESES_PJ",   rate: 3,  label: "Intereses PJ",                legalRef: "Decreto 1808, Num. 7"  },
  prestamo:     { code: "INTERESES_PJ",   rate: 3,  label: "Intereses PJ",                legalRef: "Decreto 1808, Num. 7"  },
  prestamos:    { code: "INTERESES_PJ",   rate: 3,  label: "Intereses PJ",                legalRef: "Decreto 1808, Num. 7"  },
  financiamiento:{ code: "INTERESES_PJ",  rate: 3,  label: "Intereses PJ",                legalRef: "Decreto 1808, Num. 7"  },

  // ── Seguros (1%) ──────────────────────────────────────────────────────────
  seguro:       { code: "SEGUROS_PJ",     rate: 1,  label: "Primas de Seguros PJ",        legalRef: "Decreto 1808, Num. 3"  },
  seguros:      { code: "SEGUROS_PJ",     rate: 1,  label: "Primas de Seguros PJ",        legalRef: "Decreto 1808, Num. 3"  },
  prima:        { code: "SEGUROS_PJ",     rate: 1,  label: "Primas de Seguros PJ",        legalRef: "Decreto 1808, Num. 3"  },
  primas:       { code: "SEGUROS_PJ",     rate: 1,  label: "Primas de Seguros PJ",        legalRef: "Decreto 1808, Num. 3"  },
};

// ─── Normalización ────────────────────────────────────────────────────────────

/** Normaliza a minúsculas y elimina diacríticos (tildes). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─── Función de sugerencia ────────────────────────────────────────────────────

// ─── Códigos genéricos (menor prioridad cuando hay una categoría más específica) ─

const GENERIC_CODES = new Set(["SERVICIOS_PJ", "SERVICIOS_PN"]);

/**
 * Sugiere un código ISLR basándose en las palabras clave del concepto.
 *
 * Estrategia:
 *  1. Recolectar TODAS las coincidencias exactas de las palabras del concepto
 *  2. Si no hay exactas, buscar por substring
 *  3. Preferir categorías específicas (HONORARIOS, FLETES, etc.) sobre genéricas (SERVICIOS)
 *
 * Retorna null si no hay ninguna coincidencia.
 * Pure — sin efectos secundarios, sin I/O, sin Decimal.
 */
export function suggestIslrCode(concept: string): IslrSuggestion | null {
  if (!concept.trim()) return null;

  const normalized = normalize(concept);
  const words = normalized.split(/[\s,.\-_/]+/).filter(Boolean);

  const matches: IslrSuggestion[] = [];

  // Paso 1: recolectar coincidencias exactas de todas las palabras
  for (const word of words) {
    if (MAP[word]) matches.push(MAP[word]);
  }

  // Paso 2: si no hay exactas, buscar por substring (útil para plurales/compuestos no listados)
  // Mínimo 4 chars por palabra para evitar falsos positivos de preposiciones ("de", "en", etc.)
  if (matches.length === 0) {
    for (const word of words) {
      if (word.length < 4) continue;
      for (const [key, suggestion] of Object.entries(MAP)) {
        if (key.length >= 5 && (word.includes(key) || key.includes(word))) {
          matches.push(suggestion);
        }
      }
    }
  }

  if (matches.length === 0) return null;

  // Paso 3: preferir categorías específicas sobre SERVICIOS_PJ/PN (genéricas)
  const specific = matches.find((m) => !GENERIC_CODES.has(m.code));
  return specific ?? matches[0];
}
