// src/lib/version.ts
// R-7: NUNCA modificar CERTIFIED_VERSION sin:
//   1. Nueva solicitud de homologación ante el SENIAT (PA 121, Art. 9)
//   2. Autorización recibida del SENIAT
//   3. Expediente actualizado
// Cambiar este valor sin el proceso es una infracción a la PA 121.

export const APP_VERSION = "0.1.0";

/** Versión exacta certificada por el SENIAT. null = pendiente de primera homologación. */
export const CERTIFIED_VERSION: string | null = null;

// SENIAT derogó la PA-121 (Providencia SNAT/2026/00084, Gaceta 43.435,
// 12-08-2026) — ya no existe un trámite de homologación al que estar
// "pendiente". Quedó un vacío regulatorio (podría volver algún tipo de
// homologación en el futuro), así que R-7/Z-4/Z-5 y el resto del flujo de
// SeniatSubmission se dejan intactos a propósito — solo se quita la etiqueta
// del footer, que ya no describe la realidad actual.
export const CERTIFIED_VERSION_LABEL =
  CERTIFIED_VERSION
    ? `ContaFlow v${CERTIFIED_VERSION} · Homologado SENIAT`
    : `ContaFlow v${APP_VERSION}`;
