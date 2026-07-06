// src/modules/payments/utils/idempotency.ts
// H6 (ADR-032): clave de idempotencia generada en el CLIENTE antes del submit.
// La clave viaja con el request; el servidor la persiste en PaymentRecord/PaymentBatch
// (@unique) y rechaza reintentos (timeout de red, doble pestaña, POST directo) con la
// misma clave. La protección vive en BD, no en la UI (LL-011).
export function genIdempotencyKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}
