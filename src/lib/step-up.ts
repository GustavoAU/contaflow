// src/lib/step-up.ts
// Configuración centralizada para step-up (re-verificación) en operaciones criticas (Q2-3).
//
// Patron server:
//   const { userId, has } = await auth();
//   if (!has({ reverification: STEP_UP_CONFIG })) return stepUpRequired();
//
// Patron client:
//   const [actionWithStepUp] = useReverification(myAction);
//   try { const result = await actionWithStepUp(input); }
//   catch (e) { if (isReverificationCancelledError(e)) return; throw e; }
//
// Operaciones protegidas:
//   - closeFiscalYearAction       (cierre de ejercicio)
//   - appropriateFiscalYearResult (apropiacion del resultado)
//   - removeMemberAction          (eliminar miembro)
//   - updateCompanySeniatData     (datos fiscales RIF/name)
//   - archiveCompanyAction        (archivar empresa)
//   - closeCajaCajaAction         (cierre de caja chica — CONDICIONAL: monto > umbral, ADR-039)
//   - reopenCajaCajaAction        (reapertura de caja chica — CONDICIONAL: monto > umbral, ADR-039)

import { reverificationError } from "@clerk/nextjs/server";

/** Exige re-verificacion con 2do factor en los ultimos 10 minutos. */
export const STEP_UP_CONFIG = {
  level: "second_factor" as const,
  afterMinutes: 10,
} as const;

/**
 * Umbral (VES) a partir del cual el cierre/reapertura de una caja chica exige
 * step-up 2FA (ADR-039). Aplica sobre el monto VES del asiento GL (los libros
 * son en VES aunque la caja sea USD/EUR). Comparar con Decimal.js (R-5).
 * NOTA: valor fijo en VES — revisar periódicamente por la inflación.
 */
export const CAJA_CHICA_STEP_UP_THRESHOLD_VES = "20000";

/** Re-exporta para evitar import duplicado en action files. */
export { reverificationError };

/** Tipo del error de re-verificacion (para anotar tipos de retorno). */
export type StepUpError = ReturnType<typeof reverificationError>;
