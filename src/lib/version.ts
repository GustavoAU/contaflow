// src/lib/version.ts
// R-7: NUNCA modificar CERTIFIED_VERSION sin:
//   1. Nueva solicitud de homologación ante el SENIAT (PA 121, Art. 9)
//   2. Autorización recibida del SENIAT
//   3. Expediente actualizado
// Cambiar este valor sin el proceso es una infracción a la PA 121.

export const APP_VERSION = "0.1.0";

/** Versión exacta certificada por el SENIAT. null = pendiente de primera homologación. */
export const CERTIFIED_VERSION: string | null = null;

export const CERTIFIED_VERSION_LABEL =
  CERTIFIED_VERSION
    ? `ContaFlow v${CERTIFIED_VERSION} · Homologado SENIAT`
    : `ContaFlow v${APP_VERSION} · Pendiente SENIAT`;
