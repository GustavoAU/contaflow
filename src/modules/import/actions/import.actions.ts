// src/modules/import/actions/import.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { ImportService } from "../services/ImportService";
import type { ImportAccountRow, ImportAccountRowError } from "../schemas/import.schema";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

export async function importAccountsAction(
  companyId: string,
  _userId: string, // kept for backward compat — ignored, uses auth() userId
  rows: ImportAccountRow[]
): Promise<ActionResult<{ created: number; skipped: number; errors: ImportAccountRowError[] }>> {
  try {
    // ROLES.ACCOUNTING (no ADMIN_ONLY): un Contador ya puede crear/editar/eliminar
    // cuentas una por una vía account.actions.ts con este mismo rol — la importación
    // masiva es la misma operación en lote, no un permiso adicional. Feedback tester
    // Alpha 2026-09-27: bloqueado en ADMIN_ONLY forzaba cargar el plan de cuentas
    // cuenta por cuenta si el usuario no era OWNER/ADMIN. Confirmado con el dueño.
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
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

export async function parseAccountsFileAction(
  companyId: string,
  base64: string,
  format: "xlsx" | "csv"
): Promise<ActionResult<ImportAccountRow[]>> {
  try {
    // Mismo nivel que importAccountsAction (ROLES.ACCOUNTING) — leer/previsualizar el
    // archivo no muta nada, pero se gatea igual por consistencia con el resto del flujo.
    const ctx = await requireCompanyAction(companyId, {
      roles: ROLES.ACCOUNTING,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const buffer = Buffer.from(base64, "base64");
    const rows =
      format === "csv"
        ? await ImportService.parseAccountsCsv(buffer)
        : await ImportService.parseAccountsExcel(buffer);
    return { success: true, data: rows };
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
