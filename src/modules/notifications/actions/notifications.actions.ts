"use server";
// src/modules/notifications/actions/notifications.actions.ts

import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { NotificationService, type NotificationAlert } from "../services/NotificationService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export async function getNotificationsAction(
  companyId: string
): Promise<ActionResult<NotificationAlert[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const rl = await checkRateLimit(userId, limiters.read);
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
    return toActionError(error);
  }
}
