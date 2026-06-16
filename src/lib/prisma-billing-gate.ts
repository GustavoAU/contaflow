// src/lib/prisma-billing-gate.ts
// Gate central de escritura por estado de suscripción (corte solo-lectura).
// Extensión de Prisma que bloquea TODA operación de escritura sobre modelos de
// negocio cuando la suscripción de la empresa venció. Modelos de sistema/billing
// quedan exentos. Si no puede determinar la empresa → permite (fail-open).
//
// Aplicado en src/lib/prisma.ts vía $extends. Las funciones puras se testean
// en prisma-billing-gate.test.ts.
import { Prisma, type PrismaClient } from "@prisma/client";

export const READ_ONLY_MESSAGE =
  "Tu suscripción venció. Estás en modo solo lectura — renueva tu plan para volver a operar.";

// Modelos de sistema/infra/billing que SIEMPRE pueden escribirse, aunque la
// suscripción esté vencida (billing, auditoría, auth, gobernanza, reintentos SENIAT).
export const EXEMPT_MODELS = new Set<string>([
  "Subscription",
  "SubscriptionPayment",
  "PlanChangeRequest",
  "AuditLog",
  "User",
  "Company",
  "CompanyMember",
  "ManagedClient",
  "SeniatSubmission",
]);

// Operaciones de escritura de Prisma que el gate intercepta.
export const WRITE_OPERATIONS = new Set<string>([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

export function isExemptModel(model: string | undefined): boolean {
  return !model || EXEMPT_MODELS.has(model);
}

export function isWriteOperation(operation: string): boolean {
  return WRITE_OPERATIONS.has(operation);
}

// Extrae el companyId afectado por una operación de escritura, si es determinable.
// Cubre: data.companyId, data.company.connect.id, where.companyId, y createMany (array).
// Si no lo encuentra → null (el gate permite: no puede determinar la empresa).
export function extractCompanyId(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as { data?: unknown; where?: unknown };

  const fromData = (d: unknown): string | null => {
    if (!d || typeof d !== "object") return null;
    const obj = d as { companyId?: unknown; company?: { connect?: { id?: unknown } } };
    if (typeof obj.companyId === "string") return obj.companyId;
    const connectId = obj.company?.connect?.id;
    if (typeof connectId === "string") return connectId;
    return null;
  };

  if (Array.isArray(a.data)) {
    for (const row of a.data) {
      const id = fromData(row);
      if (id) return id;
    }
  } else if (a.data) {
    const id = fromData(a.data);
    if (id) return id;
  }

  if (a.where && typeof a.where === "object") {
    const w = a.where as { companyId?: unknown };
    if (typeof w.companyId === "string") return w.companyId;
  }

  return null;
}

// Regla de corte: una suscripción permite escritura si está dentro del período y
// no está EXPIRED. Sin suscripción → permite (pre-billing / demo). Debe coincidir
// con SubscriptionService.getSubscriptionState.
export function computeWriteAllowed(
  sub: { status: string; currentPeriodEnd: Date } | null,
  now: number,
): boolean {
  if (!sub) return true;
  const withinPeriod = sub.currentPeriodEnd.getTime() >= now;
  return withinPeriod && sub.status !== "EXPIRED";
}

// Crea la extensión del gate. Recibe el cliente base (sin extender) para consultar
// el estado de suscripción sin recursión. Cachea el resultado por empresa (TTL corto).
export function createBillingGateExtension(base: PrismaClient) {
  const cache = new Map<string, { allowed: boolean; expiry: number }>();
  const TTL_MS = 30_000;

  async function isAllowed(companyId: string): Promise<boolean> {
    const now = Date.now();
    const hit = cache.get(companyId);
    if (hit && hit.expiry > now) return hit.allowed;

    let allowed = true;
    try {
      const sub = await base.subscription.findUnique({
        where: { companyId },
        select: { status: true, currentPeriodEnd: true },
      });
      allowed = computeWriteAllowed(sub, now);
    } catch (err) {
      // Fail-open: nunca bloquear una operación por un error de la consulta de billing.
      console.error("[billing-gate] verificación falló — permitiendo (fail-open):", err);
      allowed = true;
    }

    cache.set(companyId, { allowed, expiry: now + TTL_MS });
    return allowed;
  }

  return Prisma.defineExtension({
    name: "billing-gate",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (isWriteOperation(operation) && !isExemptModel(model)) {
            const companyId = extractCompanyId(args);
            if (companyId && !(await isAllowed(companyId))) {
              throw new Error(READ_ONLY_MESSAGE);
            }
          }
          return query(args);
        },
      },
    },
  });
}
