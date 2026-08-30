// src/modules/payroll/utils/auto-draft.ts
//
// Identidad del borrador automático. Vive aparte del servicio porque la UI la
// necesita para marcar el origen, y el servicio importa `prisma`: importarlo
// desde un componente cliente arrastraría Prisma entero al bundle del navegador.

/** Actor del rastro de auditoría cuando el proceso lo creó el cron.
 *
 *  Centinela grepeable, nunca el userId de una persona: poner el nombre de
 *  alguien en un documento que no creó es exactamente lo que un rastro de
 *  auditoría existe para impedir. `PayrollRun.createdByUserId` es `String` sin
 *  relación a `User`, así que no hay integridad referencial que romper. */
export const AUTO_DRAFT_ACTOR = "system:payroll-auto-draft";

export const AUTO_DRAFT_USER_AGENT = "ContaFlow-Cron/payroll-auto-draft";
