// src/lib/employee-portal-jwt.ts
// JWT utilitario para el Portal del Empleado — sin dependencias externas (crypto nativo Node).
// Algoritmo: HMAC-SHA256 sobre header.payload en base64url, misma estructura JWT estándar.

import { createHmac } from "crypto";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días

// Lazy getter — NO lanzar a nivel de módulo.
// El throw a nivel de módulo hace que Next.js falle durante el build al evaluar
// las rutas /client-portal y /employee/[token] en tiempo de compilación (SSG config collection).
// La validación se hace en runtime, dentro de cada función que usa el secret.
function getSecret(): string {
  const s = process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("EMPLOYEE_PORTAL_SECRET is required in production");
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

export interface EmployeeTokenPayload {
  sub: string;  // employeeId
  cid: string;  // companyId
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

export function signEmployeeToken(employeeId: string, companyId: string): string {
  const secret = getSecret();
  const iat = Math.floor(Date.now() / 1000);
  const payload: EmployeeTokenPayload = { sub: employeeId, cid: companyId, iat, exp: iat + TTL_SECONDS };
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${HEADER}.${encodedPayload}`;
  const signature = sign(unsigned, secret);
  return `${unsigned}.${signature}`;
}

export function verifyEmployeeToken(token: string): EmployeeTokenPayload | null {
  const secret = process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const unsigned = `${header}.${payload}`;
    const expected = sign(unsigned, secret);

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expBuf.length) return null;
    let diff = 0;
    for (let i = 0; i < sigBuf.length; i++) {
      diff |= sigBuf[i] ^ expBuf[i];
    }
    if (diff !== 0) return null;

    const decoded = JSON.parse(base64urlDecode(payload)) as EmployeeTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) return null;

    return decoded;
  } catch {
    return null;
  }
}
