// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ✅ Validar que DATABASE_URL existe antes de continuar
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida en las variables de entorno");
}

// Queries que superen este umbral se registran como warning (ADR-006: no params — PII fiscal)
const SLOW_QUERY_THRESHOLD_MS = 500;

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });

// Listener de queries lentas — desactivado en tests para evitar ruido
if (process.env.NODE_ENV !== "test") {
  prisma.$on("query", (e) => {
    if (e.duration >= SLOW_QUERY_THRESHOLD_MS) {
      // Solo loguear duración y los primeros 120 chars del SQL — NUNCA los params (contienen RIF, montos — ADR-006)
      console.warn(
        `[SLOW_QUERY] ${e.duration}ms — ${e.query.slice(0, 120)}`
      );

      // Sentry breadcrumb (no captureException — no infla quota de errores)
      if (process.env.NODE_ENV === "production") {
        // Import dinámico para evitar overhead en dev y no romper tests
        import("@sentry/nextjs")
          .then((Sentry) => {
            Sentry.addBreadcrumb({
              category: "db.slow_query",
              message: `Slow query: ${e.duration}ms`,
              data: {
                duration_ms: e.duration,
                query_preview: e.query.slice(0, 120),
              },
              level: "warning",
            });
          })
          .catch(() => {
            // Sentry fallo silencioso — no bloquear la app
          });
      }
    }
  });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
