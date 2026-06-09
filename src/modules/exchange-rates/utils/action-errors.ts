import { headers } from "next/headers";
import { mapPrismaError } from "@/lib/prisma-errors";
import type { ActionResult } from "../types/action-result";

export function toActionError(error: unknown): ActionResult<never> {
  return { success: false, error: mapPrismaError(error) };
}

// Exchange-rates actions use .at(-1) (last proxy hop) — preserve pattern.
export async function resolveIpUa() {
  const h = await headers();
  const ipAddress =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;
  return { ipAddress, userAgent };
}
