// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// ✅ Validar que DATABASE_URL existe antes de continuar
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida en las variables de entorno");
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// DECISIONS.md Fix 3: explicit pool settings to prevent infinite hang on Neon cold start.
// Default pg connectionTimeoutMillis = 0 (wait forever) → 18-min hangs observed in production.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000, // fail fast on cold start instead of hanging indefinitely
  idleTimeoutMillis: 20_000,       // release idle connections quickly — Neon charges per active connection
  max: 5,                          // Neon free tier: 5 simultaneous connections
});

const adapter = new PrismaPg(pool);

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
