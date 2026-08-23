// src/lib/portal-secret.ts
// Error tipado para "falta el secreto de firma de portales en producción".
//
// Los tres firmadores (employee-portal-jwt, client-portal-jwt, document-share-jwt)
// lanzaban un Error genérico. Eso tenía dos consecuencias medidas en producción
// (2026-08-23, EMPLOYEE_PORTAL_SECRET mal escrito en Vercel como EMPLOYER_…):
//
//   1. En las actions SIN try/catch el throw subía al error boundary del módulo
//      y tumbaba la página entera, en vez del error inline que el botón ya sabe
//      mostrar.
//   2. En la que SÍ tenía catch (documentos) el mensaje llegaba crudo al cliente
//      vía mapPrismaError → `return error.message`: en inglés y revelando el
//      nombre de la variable de entorno.
//
// Fuente única para reconocer el caso y traducirlo a mensaje de negocio.

export class MissingPortalSecretError extends Error {
  readonly envVar: string;

  constructor(envVar: string) {
    super(`${envVar} is required in production`);
    this.name = "MissingPortalSecretError";
    this.envVar = envVar;
  }
}

/** Mensaje al usuario: accionable sin filtrar el nombre de la variable. */
export const PORTAL_SECRET_USER_MESSAGE =
  "No se pudo generar el enlace: falta configuración del servidor. Contacte al administrador.";

export function isMissingPortalSecret(err: unknown): err is MissingPortalSecretError {
  return err instanceof MissingPortalSecretError;
}
