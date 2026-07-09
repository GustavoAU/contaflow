"use server";

// src/modules/company/actions/onboarding.actions.ts
//
// Acciones exclusivas del wizard de configuración inicial.
// Estas acciones NO requieren step-up 2FA porque:
//   - La empresa acaba de ser creada (sin datos financieros que proteger)
//   - Solo se permite cuando totalAccounts === 0 (empresa virgen)
//   - El actor siempre es OWNER (el mismo que creó la empresa)
// Referencia: Q2-3 aplica a modificaciones post-operación, no a setup inicial.

import { mapPrismaError } from "@/lib/prisma-errors";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import type { ActionResult } from "../types/action-result";

// ─── Schema ────────────────────────────────────────────────────────────────────

const OnboardingCompanyProfileSchema = z.object({
  companyId:             z.string().min(1),
  address:               z.string().max(300).optional(),
  telefono:              z.string().max(30).optional(),
  email:                 z.email("Email inválido").optional().or(z.literal("")),
  ciiu:                  z.string().max(10).optional(),
  actividad:             z.string().max(200).optional(),
  isSpecialContributor:  z.boolean(),
});

// ─── Actualizar perfil de empresa durante setup inicial ───────────────────────
//
// Guard adicional: verifica que la empresa aún no tenga cuentas (setup inicial).
// Si ya tiene cuentas, el usuario debe usar updateCompanySeniatDataAction (con step-up).

export async function onboardingUpdateCompanyProfileAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const validated = OnboardingCompanyProfileSchema.parse(input);

    const ctx = await requireCompanyAction(validated.companyId, { roles: ROLES.ADMIN_ONLY });
    if (!ctx.ok) return ctx.error;
    const userId = ctx.userId;

    // Guard de setup inicial: bloquear si ya hay cuentas contables
    const accountCount = await prisma.account.count({
      where: { companyId: validated.companyId },
    });
    if (accountCount > 0) {
      return {
        success: false,
        error: "La empresa ya tiene cuentas configuradas. Usa Configuración → Empresa para actualizar los datos fiscales.",
      };
    }

    const company = await prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id: validated.companyId },
        data: {
          address:              validated.address   || null,
          telefono:             validated.telefono  || null,
          email:                validated.email     || null,
          ciiu:                 validated.ciiu      || null,
          actividad:            validated.actividad || null,
          isSpecialContributor: validated.isSpecialContributor,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          companyId:  validated.companyId,
          entityId:   validated.companyId,
          entityName: "Company",
          action:     "UPDATE",
          userId,
          newValue: {
            address:              validated.address,
            telefono:             validated.telefono,
            email:                validated.email,
            ciiu:                 validated.ciiu,
            actividad:            validated.actividad,
            isSpecialContributor: validated.isSpecialContributor,
            _source: "onboarding_wizard",
          },
        },
      });

      return updated;
    });

    revalidatePath(`/company/${validated.companyId}`);
    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: company.id } };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false, error: error.issues[0].message };
    // Errores de negocio (español) pasan; técnicos de BD → genérico (no filtrar crudos).
    if (error instanceof Error) return { success: false, error: mapPrismaError(error) };
    return { success: false, error: "Error al guardar los datos de la empresa" };
  }
}
