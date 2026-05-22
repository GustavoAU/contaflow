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

import { reverificationError } from "@clerk/nextjs/server";

/** Exige re-verificacion con 2do factor en los ultimos 10 minutos. */
export const STEP_UP_CONFIG = {
  level: "second_factor" as const,
  afterMinutes: 10,
} as const;

/** Re-exporta para evitar import duplicado en action files. */
export { reverificationError };

/** Tipo del error de re-verificacion (para anotar tipos de retorno). */
export type StepUpError = ReturnType<typeof reverificationError>;
