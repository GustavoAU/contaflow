// src/modules/accounting/constants.ts
//
// Constantes del módulo de contabilidad.
// Centralizar estos valores evita magic strings dispersos y facilita búsquedas globales.

// ─── Estados de transacción ───────────────────────────────────────────────────

// Deben coincidir exactamente con los valores del enum `TransactionStatus` en Prisma.
// Cambiar un valor aquí requiere también una migración de BD.
export const TX_STATUS = {
  DRAFT:  "DRAFT",
  POSTED: "POSTED",
  VOIDED: "VOIDED",
} as const;

export type TxStatus = (typeof TX_STATUS)[keyof typeof TX_STATUS];

// ─── Paginación ───────────────────────────────────────────────────────────────

// Límite máximo de filas por página en listados de transacciones.
// Aumentar este valor incrementa la memoria y latencia de las queries.
export const MAX_PAGE_SIZE = 50;
