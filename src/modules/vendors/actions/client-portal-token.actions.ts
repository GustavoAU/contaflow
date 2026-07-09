"use server";
// src/modules/vendors/actions/client-portal-token.actions.ts
// Genera un enlace firmado de portal para que el cliente consulte su CxC.
// Solo accesible por ADMIN_ONLY (mismo nivel que Portal del Empleado).

import { ROLES } from "@/lib/auth-helpers";
import { requireCompanyAction } from "@/lib/action-guard";
import prisma from "@/lib/prisma";
import { signClientToken } from "@/lib/client-portal-jwt";

export type GenerateClientPortalTokenResult =
  | { success: true; url: string }
  | { success: false; error: string };

export async function generateClientPortalTokenAction(
  companyId: string,
  customerId: string,
): Promise<GenerateClientPortalTokenResult> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ADMIN_ONLY });
  if (!ctx.ok) return ctx.error;

  // Guard cross-tenant: el cliente debe pertenecer a esta empresa
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!customer) return { success: false, error: "Cliente no encontrado" };

  const token = signClientToken(customerId, companyId);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/client-portal/${token}`;

  return { success: true, url };
}
