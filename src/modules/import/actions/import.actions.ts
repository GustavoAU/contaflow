// src/modules/import/actions/import.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { ImportService } from "../services/ImportService";
import type { ImportAccountRow } from "../schemas/import.schema";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function importAccountsAction(
  companyId: string,
  userId: string,
  rows: ImportAccountRow[]
): Promise<ActionResult<{ created: number; skipped: number; errors: string[] }>> {
  try {
    const result = await ImportService.importAccounts(companyId, userId, rows);
    revalidatePath(`/company/${companyId}/accounts`);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al importar las cuentas" };
  }
}

export async function downloadTemplateAction(): Promise<ActionResult<string>> {
  try {
    const buffer = ImportService.generateAccountsTemplate();
    const base64 = buffer.toString("base64");
    return { success: true, data: base64 };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al generar la plantilla" };
  }
}
