import { Prisma } from "@prisma/client";

/**
 * Maps a caught Prisma error to a user-friendly message.
 * P2002 (unique constraint) and P2003 (foreign key) are mapped to Spanish messages.
 * All other errors fall through to the original message.
 */
export function mapPrismaError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "Ya existe un registro con esos datos";
    if (error.code === "P2003") return "Datos de referencia inválidos";
  }
  if (error instanceof Error) return error.message;
  return "Error inesperado";
}
