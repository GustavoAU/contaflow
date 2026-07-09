"use server";
// src/modules/notifications/actions/notifications.actions.ts

import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { NotificationService, type NotificationAlert } from "../services/NotificationService";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export async function getNotificationsAction(
  companyId: string
): Promise<ActionResult<NotificationAlert[]>> {
  // Notificaciones contables: solo roles con acceso contable
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING, limiter: limiters.read });
  if (!ctx.ok) return ctx.error;

  try {
    const alerts = await NotificationService.getAlerts(companyId);
    return { success: true, data: alerts };
  } catch (error) {
    return toActionError(error);
  }
}
