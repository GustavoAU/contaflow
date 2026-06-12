import { Prisma } from "@prisma/client";

const CONNECTION_KEYWORDS = ["timeout", "terminated", "econnreset", "econnrefused", "connection"];

function isConnectionError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return CONNECTION_KEYWORDS.some((kw) => msg.includes(kw));
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
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
  }
  if (error instanceof Error) {
    if (isConnectionError(error)) {
      return "La base de datos tardó en responder. Intenta de nuevo en unos segundos.";
    }
    return error.message;
  }
  return "Error inesperado";
}
