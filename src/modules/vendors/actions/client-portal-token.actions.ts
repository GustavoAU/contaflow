"use server";
// src/modules/vendors/actions/client-portal-token.actions.ts
// Genera un enlace firmado de portal para que el cliente consulte su CxC.
// Solo accesible por ADMIN_ONLY (mismo nivel que Portal del Empleado).

import { auth } from "@clerk/nextjs/server";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import prisma from "@/lib/prisma";
import { signClientToken } from "@/lib/client-portal-jwt";

export type GenerateClientPortalTokenResult =
  | { success: true; url: string }
  | { success: false; error: string };

export async function generateClientPortalTokenAction(
  companyId: string,
  customerId: string,
): Promise<GenerateClientPortalTokenResult> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autenticado" };

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "Sin acceso a esta empresa" };
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return { success: false, error: "Se requiere rol Administrador para generar el enlace" };
  }

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
