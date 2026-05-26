// src/lib/client-portal-jwt.ts
// JWT utilitario para el Portal del Cliente — arquitectura idéntica al Portal del Empleado.
// Reutiliza EMPLOYEE_PORTAL_SECRET; el campo "type" evita que un token de empleado
// sea válido en el portal de cliente y viceversa.
//
// NOTA: NO lanzar a nivel de módulo.
// El throw a nivel de módulo hace que Next.js falle durante el build al evaluar
// las rutas /client-portal/[token] en tiempo de compilación (SSG config collection).
// La validación se hace en runtime, dentro de cada función que usa el secret.

import { createHmac } from "crypto";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días

// Lazy getter — validación solo en runtime, nunca en module evaluation.
function getSecret(): string {
  const s = process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("EMPLOYEE_PORTAL_SECRET is required in production (used for both employee and client portals)");
  }
  return s;
}

function base64url(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padding), "base64").toString("utf8");
}

export interface ClientTokenPayload {
  sub: string;       // customerId
  cid: string;       // companyId
  type: "client";    // discriminador — evita reutilizar tokens de empleado
  iat: number;
  exp: number;
}

const HEADER = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function sign(headerPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(headerPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signClientToken(customerId: string, companyId: string): string {
  const secret = getSecret();
  const iat = Math.floor(Date.now() / 1000);
  const payload: ClientTokenPayload = {
    sub: customerId,
    cid: companyId,
    type: "client",
    iat,
    exp: iat + TTL_SECONDS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${HEADER}.${encodedPayload}`;
  const signature = sign(unsigned, secret);
  return `${unsigned}.${signature}`;
}

export function verifyClientToken(token: string): ClientTokenPayload | null {
  const secret = process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const unsigned = `${header}.${payload}`;
    const expected = sign(unsigned, secret);

    // Comparación en tiempo constante (evita timing attacks)
    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expBuf.length) return null;
    let diff = 0;
    for (let i = 0; i < sigBuf.length; i++) {
      diff |= sigBuf[i] ^ expBuf[i];
    }
    if (diff !== 0) return null;

    const decoded = JSON.parse(base64urlDecode(payload)) as ClientTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) return null;
    // Verificar discriminador de tipo — evita reutilizar tokens de empleado aquí
    if (decoded.type !== "client") return null;

    return decoded;
  } catch {
    return null;
  }
}
