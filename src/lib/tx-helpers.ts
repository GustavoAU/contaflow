// src/lib/tx-helpers.ts
// M2 (auditoría 2026-06): createInvoiceAction usaba Serializable sin timeout
// (default 5s) ni retry P2034 — P2028 frecuente en Neon cold start (~5s + 10 queries).
import * as Sentry from "@sentry/nextjs";
import prisma from "@/lib/prisma";

export const SERIALIZABLE_TX_OPTIONS = {
  isolationLevel: "Serializable" as const,
  timeout: 15000,  // 15 s: cubre cold start Neon (~5 s) + 10 queries
  maxWait: 5000,   // 5 s: espera máxima por conexión disponible
} as const;

const P2034_DELAYS = [0, 50, 150] as const;
const MAX_ATTEMPTS = P2034_DELAYS.length;

type PrismaTxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function withSerializableRetry<T>(
  fn: (tx: PrismaTxClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, P2034_DELAYS[attempt - 1]));
    }
    try {
      return await prisma.$transaction(fn, SERIALIZABLE_TX_OPTIONS);
    } catch (e) {
      const isSerializationFailure = (e as { code?: string }).code === "P2034";
      if (isSerializationFailure && attempt < MAX_ATTEMPTS) {
        if (attempt === MAX_ATTEMPTS - 1) {
          Sentry.captureMessage(
            `withSerializableRetry: P2034 en intento ${attempt} — reintentando`,
            "warning"
          );
        }
        continue;
      }
      throw e;
    }
  }
  // Inalcanzable — el loop siempre lanza o retorna antes.
  throw new Error("withSerializableRetry: max attempts reached");
}
