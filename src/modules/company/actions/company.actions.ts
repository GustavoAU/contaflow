// src/modules/company/actions/company.actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { CompanyService } from "../services/CompanyService";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateCompanySchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  userId: z.string().min(1),
  rif: z.string().optional(),
  address: z.string().optional(),
});

// ─── Tipo de respuesta ────────────────────────────────────────────────────────

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Crear empresa ────────────────────────────────────────────────────────────

export async function createCompanyAction(
  input: z.infer<typeof CreateCompanySchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const validated = CreateCompanySchema.parse(input);
    const company = await CompanyService.createCompany(
      validated.name,
      validated.userId,
      validated.rif,
      validated.address
    );

    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id, name: company.name } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al crear la empresa" };
  }
}

// ─── Archivar empresa ─────────────────────────────────────────────────────────

export async function archiveCompanyAction(
  companyId: string,
  userId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const company = await CompanyService.archiveCompany(companyId, userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al archivar la empresa" };
  }
}

// ─── Reactivar empresa ────────────────────────────────────────────────────────

export async function reactivateCompanyAction(
  companyId: string,
  userId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const company = await CompanyService.reactivateCompany(companyId, userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al reactivar la empresa" };
  }
}
