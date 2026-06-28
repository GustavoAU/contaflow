import { Prisma } from "@prisma/client";

const CONNECTION_KEYWORDS = ["timeout", "terminated", "econnreset", "econnrefused", "connection"];

// Señales de errores técnicos de Postgres/BD que NUNCA deben llegar crudos al usuario
// (information disclosure) ni en inglés — p.ej. "permission denied for schema public" del
// SET LOCAL ROLE / set_config de RLS. Los errores de negocio se lanzan en español y no
// contienen estas cadenas, así que esta lista no los oculta por error.
const TECHNICAL_DB_KEYWORDS = [
  "permission denied",
  "schema public",
  "set local",
  "set role",
  "set_config",
  "syntax error",
  "pg_",
  "prisma",
];

const GENERIC_DB_ERROR =
  "No se pudo completar la operación por un problema de base de datos. Intenta de nuevo; si el problema persiste, contacta al administrador.";

function isConnectionError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return CONNECTION_KEYWORDS.some((kw) => msg.includes(kw));
}

function isTechnicalDbError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return TECHNICAL_DB_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * Maps a caught Prisma error to a user-friendly message.
 * P2002 (unique constraint) and P2003 (foreign key) are mapped to Spanish messages.
 * Connection/timeout errors show a retry prompt instead of leaking raw DB messages.
 */
// B1 (auditoría 2026-06): reemplaza detección frágil por substring (includes("P2002"))
export function isPrismaError(error: unknown, code: string): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export function mapPrismaError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "Ya existe un registro con esos datos";
    if (error.code === "P2003") return "Datos de referencia inválidos";
    // P2010: raw query failed (p.ej. SET LOCAL ROLE / set_config sin permisos RLS).
    // El mensaje crudo de Postgres viene en inglés — nunca exponerlo al usuario.
    if (error.code === "P2010") return GENERIC_DB_ERROR;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
  }
  // Errores de validación de Prisma ("Invalid `prisma.model.method()` invocation…") — técnicos.
  if (error instanceof Prisma.PrismaClientValidationError) {
    return GENERIC_DB_ERROR;
  }
  if (error instanceof Error) {
    if (isConnectionError(error)) {
      return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
    }
    // Errores técnicos de BD (permisos, schema, sintaxis…) → mensaje genérico en español.
    // Evita fugar mensajes internos de Postgres como "permission denied for schema public".
    if (isTechnicalDbError(error)) return GENERIC_DB_ERROR;
    return error.message;
  }
  return "Error inesperado";
}
