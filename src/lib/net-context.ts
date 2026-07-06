// src/lib/net-context.ts
// Derivación canónica de ipAddress/userAgent para AuditLog (R-6, PA-121 / ADR-041).
//
// Antes re-implementada en 44 archivos de actions, con divergencia real:
// payment-batch usaba `[0]` (la PRIMERA IP de x-forwarded-for — la escribe el
// cliente y es spoofeable) mientras el resto usaba `.at(-1)` (la ÚLTIMA — la
// añade NUESTRO proxy y es confiable). El canónico es `.at(-1)`.
import { headers } from "next/headers";

export type NetContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export async function netContext(): Promise<NetContext> {
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}
