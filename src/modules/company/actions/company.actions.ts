// src/modules/company/actions/company.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { mapPrismaError } from "@/lib/prisma-errors";
import { CompanyService } from "../services/CompanyService";
import { canAccess, ROLES } from "@/lib/auth-helpers";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UpdateCompanySeniatSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  rif: z
    .string()
    .regex(/^[JVEGCP]-\d{8}-?\d?$/i, "RIF inválido (ej: J-12345678-9)")
    .optional()
    .or(z.literal("")),
  address: z.string().max(300).optional(),
  telefono: z.string().max(30).optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  ciiu: z.string().max(10).optional(),
  actividad: z.string().max(200).optional(),
  isSpecialContributor: z.boolean(),
});

const CreateCompanySchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  userId: z.string().optional(), // kept for backward compat — action uses auth() userId
  rif: z.string().optional(),
  address: z.string().optional(),
});

// ─── Tipo de respuesta ────────────────────────────────────────────────────────

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

// ─── Actualizar datos SENIAT ──────────────────────────────────────────────────

export async function updateCompanySeniatDataAction(
  input: z.infer<typeof UpdateCompanySeniatSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = UpdateCompanySeniatSchema.parse(input);

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado" };

    const company = await CompanyService.updateSeniatData(validated.companyId, userId, {
      name: validated.name,
      rif: validated.rif || null,
      address: validated.address || null,
      telefono: validated.telefono || null,
      email: validated.email || null,
      ciiu: validated.ciiu || null,
      actividad: validated.actividad || null,
      isSpecialContributor: validated.isSpecialContributor,
    });

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: company.id } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Crear empresa ────────────────────────────────────────────────────────────

export async function createCompanyAction(
  input: z.infer<typeof CreateCompanySchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = CreateCompanySchema.parse(input);
    const company = await CompanyService.createCompany(
      validated.name,
      userId, // always use auth() userId
      validated.rif,
      validated.address
    );

    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id, name: company.name } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Archivar empresa ─────────────────────────────────────────────────────────

export async function archiveCompanyAction(
  companyId: string,
  _userId?: string // kept for backward compat — ignored, uses auth() userId
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado" };

    const company = await CompanyService.archiveCompany(companyId, userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Reactivar empresa ────────────────────────────────────────────────────────

export async function reactivateCompanyAction(
  companyId: string,
  _userId?: string // kept for backward compat — ignored, uses auth() userId
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const member = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!member) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(member.role, ROLES.ADMIN_ONLY)) return { success: false, error: "No autorizado" };

    const company = await CompanyService.reactivateCompany(companyId, userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}
