"use server";
// src/modules/payroll/actions/employee-portal-token.actions.ts
// Genera un enlace firmado de portal para que el empleado consulte su información.
// Solo accesible por ADMIN_ONLY (R-6).

import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import { signEmployeeToken } from "@/lib/employee-portal-jwt";
import { isMissingPortalSecret, PORTAL_SECRET_USER_MESSAGE } from "@/lib/portal-secret";

export type GeneratePortalTokenResult =
  | { success: true; url: string }
  | { success: false; error: string };

export async function generatePortalTokenAction(
  companyId: string,
  employeeId: string,
): Promise<GeneratePortalTokenResult> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
  if (!ctx.ok) return ctx.error;

  // Verificar que el empleado existe y pertenece a esta empresa (cross-tenant guard)
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!employee) return { success: false, error: "Empleado no encontrado" };

  // La firma lanza si falta el secreto en producción. Sin este catch el throw
  // sube al error boundary de nómina y tumba la página entera (medido 2026-08-23).
  try {
    const token = signEmployeeToken(employeeId, companyId);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return { success: true, url: `${baseUrl}/employee/${token}` };
  } catch (err) {
    if (isMissingPortalSecret(err)) {
      console.error("[generatePortalTokenAction] Falta", err.envVar, "en el entorno");
      return { success: false, error: PORTAL_SECRET_USER_MESSAGE };
    }
    throw err;
  }
}
