// src/modules/company/types/action-result.ts
export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };
