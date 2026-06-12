// src/lib/document-share-jwt.ts
// JWT utilitario para compartir documentos (facturas / retenciones) con auditores SENIAT.
// Sin dependencias externas — crypto nativo Node (HMAC-SHA256).
// Patrón idéntico a employee-portal-jwt.ts.

import { createHmac } from "crypto";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días

export type DocShareType = "INVOICE" | "RETENTION";

export interface DocSharePayload {
  jti: string;       // JWT ID único — permite revocación en DB
  typ: DocShareType; // tipo de documento
  did: string;       // documentId (invoiceId / retentionId)
  cid: string;       // companyId — validado contra la URL para prevenir IDOR
  iat: number;
  exp: number;
}

function getSecret(): string {
  const s = process.env.DOC_SHARE_SECRET ?? process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("DOC_SHARE_SECRET is required in production");
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

const HEADER = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function sign(headerPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(headerPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signDocShareToken(
  docType: DocShareType,
  docId: string,
  companyId: string,
): { token: string; jti: string } {
  const secret = getSecret();
  const iat = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const payload: DocSharePayload = {
    jti,
    typ: docType,
    did: docId,
    cid: companyId,
    iat,
    exp: iat + TTL_SECONDS,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${HEADER}.${encodedPayload}`;
  const signature = sign(unsigned, secret);
  return { token: `${unsigned}.${signature}`, jti };
}

export function verifyDocShareToken(token: string): DocSharePayload | null {
  const secret = process.env.DOC_SHARE_SECRET ?? process.env.EMPLOYEE_PORTAL_SECRET ?? "";
  if (!secret) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const unsigned = `${header}.${payload}`;
    const expected = sign(unsigned, secret);

    // Comparación en tiempo constante — previene timing attacks
    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    if (sigBuf.length !== expBuf.length) return null;
    let diff = 0;
    for (let i = 0; i < sigBuf.length; i++) {
      diff |= sigBuf[i]! ^ expBuf[i]!;
    }
    if (diff !== 0) return null;

    const decoded = JSON.parse(base64urlDecode(payload)) as DocSharePayload;
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) return null;

    return decoded;
  } catch {
    return null;
  }
}
