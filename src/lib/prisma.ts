// lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// ✅ Validar que DATABASE_URL existe antes de continuar
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida en las variables de entorno");
}

const globalForPrisma = global as unknown as { prisma: PrismaClient };

// Root cause Neon cold start: PgBouncer acepta la TCP pero Neon manda FIN mientras
// su compute arranca → "Server has closed the connection". No es un timeout, es un
// cierre activo. connect_timeout solo cubre el handshake inicial, no esto.
// La solución es: Pool explícito con error handler + retry via withDbRetry().
function withNeonTimeouts(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connect_timeout", "30");
  return u.toString();
}

const pool = new Pool({
  connectionString: withNeonTimeouts(process.env.DATABASE_URL),
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 60_000, // 60s — da tiempo al usuario de llenar un form sin reconectar
  max: 5,
  query_timeout: 30_000,
});

// Evitar crash de Node.js cuando una conexión idle muere en background.
// pg emite "error" en el Pool; sin handler => process crash en Node.js.
pool.on("error", () => {
  // pg elimina el cliente muerto del pool automáticamente.
  // El próximo checkout creará una conexión nueva.
});

// Note: query events ($on "query") are not supported with @prisma/adapter-pg (Prisma 7.x).
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log: [
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Neon cold start: PgBouncer manda "Server has closed the connection" mientras
// el compute arranca. Esperar 2s y reintentar suele ser suficiente.
// Uso: return withDbRetry(() => prisma.foo.create({...}))

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
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  // unreachable
  throw new Error("withDbRetry: exhausted retries");
}
