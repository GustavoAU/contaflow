// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ✅ Validar que DATABASE_URL existe antes de continuar
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida en las variables de entorno");
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// DECISIONS.md Fix 3: explicit pool settings to prevent infinite hang on Neon cold start.
// Pass config directly (not a Pool instance) — PrismaPg creates its own Pool internally.
// Default pg connectionTimeoutMillis = 0 (wait forever) → 18-min hangs observed in production.
//
// connect_timeout=10 in the URL sets a TCP socket-level timeout during the PostgreSQL handshake
// (the phase before any query runs). connectionTimeoutMillis only covers pool-queue waiting.
// query_timeout limits how long any individual query may run — catches hung Serializable waits.
function withNeonTimeouts(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("connect_timeout")) {
    u.searchParams.set("connect_timeout", "10"); // abort TCP handshake after 10s
  }
  return u.toString();
}

const adapter = new PrismaPg({
  connectionString: withNeonTimeouts(process.env.DATABASE_URL),
  connectionTimeoutMillis: 10_000, // pool-queue wait: fail fast instead of hanging indefinitely
  idleTimeoutMillis: 20_000,       // release idle connections quickly — Neon charges per active connection
  max: 5,                          // Neon free tier: 5 simultaneous connections
  query_timeout: 30_000,           // 30s per query — prevents hung Serializable locks from blocking forever
});

// Note: query events ($on "query") are not supported with @prisma/adapter-pg (Prisma 7.x).
// Slow-query monitoring via $on is disabled; use pgBouncer/Neon metrics for production observability.
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: [
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
