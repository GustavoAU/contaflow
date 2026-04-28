"use server";
// src/modules/analytics/actions/p2034-counters.actions.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { redis } from "@/lib/ratelimit";

export type P2034DayCount = { date: string; count: number };

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function getP2034CountersAction(
  companyId: string
): Promise<ActionResult<P2034DayCount[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Se requiere rol Admin o superior" };

  if (!redis) return { success: true, data: [] };

  try {
    const today = new Date();
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    });

    const keys = dates.map((date) => `p2034:${companyId}:${date}`);
    const raw = (await redis.mget(...keys)) as (number | null)[];

    return {
      success: true,
      data: dates.map((date, i) => ({ date, count: raw[i] ?? 0 })),
    };
  } catch {
    return { success: true, data: [] };
  }
}
