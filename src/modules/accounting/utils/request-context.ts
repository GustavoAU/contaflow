// src/modules/accounting/utils/request-context.ts
//
// Extrae IP y User-Agent del request HTTP para auditoria (R-6).
// La extraccion es identica en todas las Server Actions del modulo, por lo que
// centralizar aqui evita divergencias silenciosas entre archivos.

import { headers } from "next/headers";

export async function extractRequestContext(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();

  // x-real-ip es el header preferido (un solo valor, IP del cliente real).
  // x-forwarded-for puede contener una cadena de proxies separados por comas;
  // el primero (indice 0) es la IP original del cliente (R-6).
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Truncar a 512 chars para evitar payloads maliciosos en AuditLog.userAgent.
  const userAgentRaw = h.get("user-agent") ?? "";
  const userAgent = userAgentRaw.slice(0, 512) || null;

  return { ipAddress, userAgent };
}
