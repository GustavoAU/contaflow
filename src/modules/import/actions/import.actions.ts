// src/modules/import/actions/import.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { ImportService } from "../services/ImportService";
import type { ImportAccountRow } from "../schemas/import.schema";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export async function importAccountsAction(
  companyId: string,
  _userId: string, // kept for backward compat — ignored, uses auth() userId
  rows: ImportAccountRow[]
): Promise<ActionResult<{ created: number; skipped: number; errors: string[] }>> {
  try {
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    if (rows.length > 1000) {
      return { success: false, error: "El archivo supera el límite de 1000 cuentas por importación." };
    }

    const result = await ImportService.importAccounts(companyId, ctx.userId, rows);
    revalidatePath(`/company/${companyId}/accounts`);
    return { success: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}

export async function downloadTemplateAction(): Promise<ActionResult<string>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };
    const buffer = await ImportService.generateAccountsTemplate();
    const base64 = buffer.toString("base64");
    return { success: true, data: base64 };
  } catch (error) {
    return toActionError(error);
  }
}
