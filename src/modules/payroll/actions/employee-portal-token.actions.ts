"use server";
// src/modules/payroll/actions/employee-portal-token.actions.ts
// Genera un enlace firmado de portal para que el empleado consulte su información.
// Solo accesible por ADMIN_ONLY (R-6).

import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import { signEmployeeToken } from "@/lib/employee-portal-jwt";

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

  const token = signEmployeeToken(employeeId, companyId);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/employee/${token}`;

  return { success: true, url };
}
