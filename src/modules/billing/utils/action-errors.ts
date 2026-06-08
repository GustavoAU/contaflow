// src/modules/billing/utils/action-errors.ts
import { z } from "zod";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";

export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) return { success: false, error: "Datos inválidos" };
  return { success: false, error: mapPrismaError(error) };
}
