// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida en las variables de entorno");
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Switched from pg+PgBouncer to @neondatabase/serverless WebSocket.
// pg+PgBouncer root cause: PgBouncer has a hardcoded ~20s server_connect_timeout;
// every cold-start attempt hangs 20s then fails, retries never succeed in time.
// Neon's WS proxy handles cold starts natively — it queues the connection request
// while the compute wakes up instead of timing out at 20s.
// Node 22+ has built-in WebSocket; no external 'ws' package needed.
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaNeon({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 60_000,
    }),
    log: [
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Safety net for transient network errors. With the Neon WS driver, cold starts
// are handled by the driver itself, so this is rarely triggered.

const RETRYABLE = [
  "server has closed the connection",
  "connection terminated",
  "econnreset",
  "econnrefused",
  "connection timeout",
];

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return RETRYABLE.some((kw) => msg.includes(kw));
}

export async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries - 1 && isRetryable(err)) {
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      throw err;
    }
  }
  // unreachable
  throw new Error("withDbRetry: exhausted retries");
}
