// src/modules/payments/utils/idempotency.ts
// H6 (ADR-032): clave de idempotencia generada en el CLIENTE antes del submit.
// La clave viaja con el request; el servidor la persiste en PaymentRecord/PaymentBatch
// (@unique) y rechaza reintentos (timeout de red, doble pestaña, POST directo) con la
// misma clave. La protección vive en BD, no en la UI (LL-011).
//
// UUID estricto — el schema Zod lo exige con .uuid() (security-agent: el unique es
// global en la tabla, sin fallback de texto libre). crypto.randomUUID está disponible
// en todo secure context (HTTPS/localhost) y en Node 19+.
export function genIdempotencyKey(): string {
  return crypto.randomUUID();
}
