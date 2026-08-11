// src/modules/company/actions/company.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import prisma, { withDbRetry } from "@/lib/prisma";
import { CompanyService } from "../services/CompanyService";
// MP-4 (ADR-042): nada de VEN_* aquí — el formato del ID tributario sale de la
// config del país (getFiscalConfig), que en el alta viene del selector y en la
// edición SENIAT del guard (ctx.country).
import { getFiscalConfig, isSupportedCountry, type CountryCode } from "@/lib/countries";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import { STEP_UP_CONFIG, reverificationError, type StepUpError } from "@/lib/step-up";
import type { ActionResult } from "../types/action-result";
import { toActionError } from "../utils/action-errors";
// Helper sincrónico: vive fuera de este módulo porque "use server" solo admite
// exports async. Ver src/modules/company/utils/rif-grandfathering.ts
import { assertRifEditable } from "../utils/rif-grandfathering";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const UpdateCompanySeniatSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  // El formato NO se valida aquí: una regex laxa anterior (dígito verificador
  // opcional) dejó empresas con RIF legacy en BD. Validarlo en el schema las
  // dejaría sin poder editar NINGÚN dato SENIAT (dirección, teléfono, CIIU…).
  // La validación estricta se aplica abajo solo si el RIF CAMBIA — ver
  // assertRifEditable. MP-1 / ADR-042.
  rif: z.string().max(20).optional().or(z.literal("")),
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
  // MP-4: el país decide el formato del ID tributario. Ausente = "VEN" (callers
  // legacy); un valor NO soportado es ERROR, nunca coerción silenciosa — en
  // escritura, coercer input del usuario guardaría algo distinto de lo elegido.
  country: z.string().optional(),
  // El formato se valida DESPUÉS del parse, contra taxIdRegex del país elegido
  // (el schema es estático y el país es dinámico).
  rif: z
    .string()
    .max(20)
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

    // Formato del RIF: estricto solo si cambia (grandfathering de RIF legacy).
    // MP-4: la regex sale del país de la empresa (ctx.country, ADR-042 D-2).
    const current = await prisma.company.findUnique({
      where: { id: validated.companyId },
      select: { rif: true },
    });
    const rifError = assertRifEditable(
      validated.rif ?? null,
      current?.rif ?? null,
      getFiscalConfig(ctx.country).taxIdRegex,
    );
    if (rifError) return { success: false, error: rifError };

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

    // MP-4: país soportado o error explícito; ausente = VEN (callers legacy)
    const country: CountryCode = (() => {
      if (validated.country === undefined || validated.country === "") return "VEN";
      if (!isSupportedCountry(validated.country)) {
        throw Object.assign(new Error("UNSUPPORTED_COUNTRY"), { isUnsupportedCountry: true });
      }
      return validated.country;
    })();

    // Formato del ID tributario según el país elegido
    const cfg = getFiscalConfig(country);
    if (validated.rif && !cfg.taxIdRegex.test(validated.rif)) {
      return {
        success: false,
        error: `${cfg.taxIdLabel} inválido (ej: ${cfg.taxIdPlaceholder})`,
      };
    }

    // withDbRetry: reintenta hasta 2 veces si Neon cierra la conexión durante cold start.
    // El retry espera 2s entre intentos para que PgBouncer tenga tiempo de reconectar.
    const company = await withDbRetry(async () => {
      const ownedCount = await prisma.companyMember.count({
        where: { userId, role: "OWNER", company: { status: { not: "ARCHIVED" } } },
      });
      if (ownedCount >= COMPANY_LIMIT_PER_USER) {
        throw Object.assign(new Error("PLAN_LIMIT"), { isPlanLimit: true });
      }
      return CompanyService.createCompany(validated.name, userId, validated.rif, validated.address, validated.scopeProfile, validated.telefono, country);
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
    if (error instanceof Error && (error as Error & { isUnsupportedCountry?: boolean }).isUnsupportedCountry) {
      return { success: false, error: "País no soportado todavía." };
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
