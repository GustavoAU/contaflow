// src/modules/cajachica/utils/log-rejection.ts
// HC-08 (ADR-037 D-2): registro best-effort de rechazos de regla de negocio.
//
// Los rechazos de regla se lanzan DENTRO del $transaction del servicio → el rollback
// revierte cualquier AuditLog escrito ahí. Por eso el rastro del rechazo debe escribirse
// FUERA de la transacción fallida, en el catch de la action, como un auditLog.create
// independiente. AuditLog está EXENTO del billing gate (prisma-billing-gate.ts), así que
// el rechazo se registra aun con la suscripción vencida.
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isPrismaError, mapPrismaError } from "@/lib/prisma-errors";

const CONNECTION_KEYWORDS = ["timeout", "terminated", "econnreset", "econnrefused", "connection"];

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return CONNECTION_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * Filtra qué se loguea: SOLO rechazos de regla de negocio (ADR-037 D-2.3).
 * Excluye infra/conexión (no son rechazos de regla; además el propio auditLog.create
 * fallaría si la DB está caída) y el P2002 transitorio de correlativo (Z-1, ruido).
 * Los errores Zod nunca llegan aquí: la action retorna antes del try (safeParse).
 */
export function shouldLogRejection(error: unknown): boolean {
  // Inicialización de Prisma / DB no disponible → infra, no regla.
  if (error instanceof Prisma.PrismaClientInitializationError) return false;
  // Conexión / timeout → infra, no regla.
  if (isConnectionError(error)) return false;
  // P2002 transitorio de correlativo (voucherNumber/number) → reintento, no violación.
  if (isPrismaError(error, "P2002")) return false;
  return true;
}

/**
 * Registra un rechazo de regla de negocio en AuditLog. Best-effort:
 * NUNCA relanza ni altera el flujo / el error que ve el usuario (try/catch interno).
 * Append-only (ADR-006 D-4): solo create, nunca update/delete.
 */
export async function logRejection(params: {
  companyId: string;
  userId: string;
  action: string; // p.ej. "CREATE_MOVEMENT" → se persiste "CREATE_MOVEMENT_REJECTED"
  entityName: string; // p.ej. "CajaCajaMovement"
  entityId?: string; // id si la action lo conoce; para creaciones → sentinel "N/A"
  reason: string; // mensaje de negocio (e.message) — NUNCA input crudo del usuario (sin PII)
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        companyId: params.companyId,
        userId: params.userId,
        action: `${params.action}_REJECTED`,
        entityName: params.entityName,
        entityId: params.entityId ?? "N/A",
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        // reason = mensaje de regla nuestro (no concept/notes/providerRif → sin PII).
        newValue: { reason: params.reason, outcome: "REJECTED" },
      },
    });
  } catch {
    // best-effort: si el log falla (p.ej. DB caída), se traga el error.
    // El flujo y el error que ve el usuario quedan intactos.
  }
}
