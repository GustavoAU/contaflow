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
// connect_timeout=30 en la URL: timeout TCP-level durante el handshake de PostgreSQL.
// Neon cold start puede tardar 5-15s — con 10s se corta justo cuando Neon está despertando.
// connectionTimeoutMillis cubre la espera en la cola del pool (misma razón para 30s).
// query_timeout limita queries individuales — captura locks Serializable colgados.
function withNeonTimeouts(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connect_timeout", "30"); // 30s — margen para Neon cold start (5-15s típico)
  return u.toString();
}

const adapter = new PrismaPg({
  connectionString: withNeonTimeouts(process.env.DATABASE_URL),
  connectionTimeoutMillis: 30_000, // igual que connect_timeout — evita que el pool abandone antes
  idleTimeoutMillis: 20_000,       // release idle connections quickly — Neon charges per active connection
  max: 5,                          // Neon free tier: 5 simultaneous connections
  query_timeout: 30_000,           // 30s por query — captura locks Serializable colgados
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
