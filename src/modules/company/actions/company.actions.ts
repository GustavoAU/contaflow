// src/modules/company/actions/company.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import prisma, { withDbRetry } from "@/lib/prisma";
import { CompanyService } from "../services/CompanyService";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { STEP_UP_CONFIG, reverificationError, type StepUpError } from "@/lib/step-up";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";

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
  rif: z
    .string()
    .regex(/^[JVEGCP]-\d{8}-?\d?$/i, "RIF inválido (ej: J-12345678-9)")
    .optional()
    .or(z.literal(""))
    .or(z.undefined()),
  address: z.string().optional(),
  // Obligatorio: se usa para recordatorios de renovación por WhatsApp/email
  telefono: z
    .string()
    .min(1, "El teléfono es obligatorio")
    .refine((v) => v.replace(/\D/g, "").length >= 10, "Teléfono inválido (incluye código de área, ej: 0412-1234567)"),
  scopeProfile: z.enum(["SOLO", "EMPRESA", "DESPACHO"]).optional(),
});

const UpdateScopeProfileSchema = z.object({
  companyId: z.string().min(1),
  scopeProfile: z.enum(["SOLO", "EMPRESA", "DESPACHO"]),
});

// ─── Actualizar datos SENIAT ──────────────────────────────────────────────────

export async function updateCompanySeniatDataAction(
  input: z.infer<typeof UpdateCompanySeniatSchema>
): Promise<ActionResult<{ id: string }> | StepUpError> {
  try {
    const validated = UpdateCompanySeniatSchema.parse(input);

    const ctx = await requireCompanyAction(validated.companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;

    // Q2-3: Step-up — re-verificación con 2do factor para modificar datos fiscales SENIAT
    // ADR-041 D-4: check extra/más restrictivo DESPUÉS del guard central
    const { has } = await auth();
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    const company = await CompanyService.updateSeniatData(validated.companyId, ctx.userId, {
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
    return toActionError(error);
  }
}

// ─── Crear empresa ────────────────────────────────────────────────────────────

/**
 * Límite de empresas por usuario en el plan base.
 * Billing P-2: incrementar según plan suscrito cuando se integre Stripe/NOWPayments.
 */
const COMPANY_LIMIT_PER_USER = 1;

export async function createCompanyAction(
  input: z.infer<typeof CreateCompanySchema>
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const validated = CreateCompanySchema.parse(input);

    // withDbRetry: reintenta hasta 2 veces si Neon cierra la conexión durante cold start.
    // El retry espera 2s entre intentos para que PgBouncer tenga tiempo de reconectar.
    const company = await withDbRetry(async () => {
      const ownedCount = await prisma.companyMember.count({
        where: { userId, role: "OWNER", company: { status: { not: "ARCHIVED" } } },
      });
      if (ownedCount >= COMPANY_LIMIT_PER_USER) {
        throw Object.assign(new Error("PLAN_LIMIT"), { isPlanLimit: true });
      }
      return CompanyService.createCompany(validated.name, userId, validated.rif, validated.address, validated.scopeProfile, validated.telefono);
    });

    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id, name: company.name } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    if (error instanceof Error && (error as Error & { isPlanLimit?: boolean }).isPlanLimit) {
      return {
        success: false,
        error: "Tu plan incluye 1 empresa. ¿Gestionas múltiples RIFs? Escríbenos a info@contaflow.app para un plan de despacho.",
      };
    }
    return toActionError(error);
  }
}

// ─── Actualizar perfil de alcance ────────────────────────────────────────────

export async function updateScopeProfileAction(
  input: z.infer<typeof UpdateScopeProfileSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const validated = UpdateScopeProfileSchema.parse(input);

    const ctx = await requireCompanyAction(validated.companyId, { roles: ROLES.ADMIN_ONLY, captureNet: true });
    if (!ctx.ok) return ctx.error;

    await prisma.$transaction(async (tx) => {
      const old = await tx.company.findUniqueOrThrow({ where: { id: validated.companyId } });
      const updated = await tx.company.update({
        where: { id: validated.companyId },
        data: { scopeProfile: validated.scopeProfile },
      });
      await tx.auditLog.create({
        data: {
          companyId: validated.companyId,
          entityId: validated.companyId,
          entityName: "Company",
          action: "UPDATE",
          userId: ctx.userId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          oldValue: old as object,
          newValue: updated as object,
        },
      });
    });

    revalidatePath(`/company/${validated.companyId}`);
    return { success: true, data: { id: validated.companyId } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    return toActionError(error);
  }
}

// ─── Archivar empresa ─────────────────────────────────────────────────────────

export async function archiveCompanyAction(
  companyId: string,
  _userId?: string // kept for backward compat — ignored, uses auth() userId
): Promise<ActionResult<{ id: string }> | StepUpError> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;

    // Q2-3: Step-up — re-verificación con 2do factor para archivar empresa
    // ADR-041 D-4: check extra/más restrictivo DESPUÉS del guard central
    const { has } = await auth();
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    const company = await CompanyService.archiveCompany(companyId, ctx.userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Reactivar empresa ────────────────────────────────────────────────────────

export async function reactivateCompanyAction(
  companyId: string,
  _userId?: string // kept for backward compat — ignored, uses auth() userId
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;

    const company = await CompanyService.reactivateCompany(companyId, ctx.userId);
    revalidatePath("/dashboard");
    return { success: true, data: { id: company.id } };
  } catch (error) {
    return toActionError(error);
  }
}
