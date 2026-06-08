// src/modules/certificates/utils/action-errors.ts
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";

export function toActionError(error: unknown): ActionResult<never> {
  return { success: false, error: mapPrismaError(error) };
}
