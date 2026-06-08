// src/modules/bank-reconciliation/types/action-result.ts
export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };
