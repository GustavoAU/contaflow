"use server";
// src/modules/notifications/actions/notifications.actions.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { NotificationService, type NotificationAlert } from "../services/NotificationService";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function getNotificationsAction(
  companyId: string
): Promise<ActionResult<NotificationAlert[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed) return { success: false, error: "Demasiadas solicitudes. Intente más tarde." };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Empresa no encontrada o acceso denegado" };
  // Notificaciones contables: solo roles con acceso contable
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Se requiere rol Contador o superior" };

  try {
    const alerts = await NotificationService.getAlerts(companyId);
    return { success: true, data: alerts };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error inesperado" };
  }
}
