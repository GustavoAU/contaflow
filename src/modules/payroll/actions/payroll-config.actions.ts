"use server";
// src/modules/payroll/actions/payroll-config.actions.ts
// Fase NOM-A: Server Actions para configuración de nómina
//
// Security findings addressed (audit NOM-A 2026-04-15):
//   NOM-A-01 (CRITICAL): companyId siempre verificado via companyMember.findFirst
//   NOM-A-02 (CRITICAL): UPSERT en $transaction con AuditLog — ver PayrollConfigService
//   NOM-A-03 (HIGH):     ivssEnabled/incesEnabled/banavihEnabled son toggles fiscales;
//                        requieren confirmación en UI y ADMIN_ONLY + AuditLog completo
//   NOM-A-04 (HIGH):     rate limit con limiters.fiscal en savePayrollConfigAction
//   NOM-A-05 (HIGH):     write = ADMIN_ONLY, read = cualquier miembro (VIEWER solo status)

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import { PayrollConfigSchema } from "../schemas/payroll-config.schema";
import { PayrollConfigService } from "../services/PayrollConfigService";
import type { PayrollConfigRow } from "../services/PayrollConfigService";

type Result<T> = { success: true; data: T } | { success: false; error: string };

// ── savePayrollConfigAction — ADMIN_ONLY + rate limit ─────────────────────────
// NOM-A-05: Solo OWNER y ADMIN pueden crear/actualizar la configuración de nómina.
// Equivalente a "Configuración de empresa" — decisión de gerencia, no de contabilidad.
export async function savePayrollConfigAction(
  companyId: string,
  rawInput: unknown
): Promise<Result<PayrollConfigRow>> {
  // 1. Autenticación
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. NOM-A-01: verificar membresía antes del rate limit para evitar que un userId
  //    sin pertenencia consuma cuota — defensa en profundidad
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "No autorizado" };

  // 3. NOM-A-05: solo ADMIN_ONLY puede escribir configuración de nómina
  if (!canAccess(member.role, ROLES.ADMIN_ONLY))
    return { success: false, error: "Solo el Administrador puede configurar la nómina" };

  // 4. Rate limit — NOM-A-04: es una mutación fiscal
  const rl = await checkRateLimit(userId, limiters.fiscal);
  if (!rl.allowed)
    return { success: false, error: "Demasiadas solicitudes. Intenta en unos minutos." };

  // 5. Validación Zod
  const parsed = PayrollConfigSchema.safeParse(rawInput);
  if (!parsed.success)
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const h = await headers();
  const ipAddress = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? null;
  const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

  try {
    const cfg = await PayrollConfigService.saveConfig(companyId, userId, parsed.data, ipAddress, userAgent);
    revalidatePath(`/company/${companyId}/payroll`);
    return { success: true, data: cfg };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al guardar configuración";
    return { success: false, error: msg };
  }
}

// ── getPayrollConfigAction — cualquier miembro (excl. VIEWER) ─────────────────
// Un ACCOUNTANT necesita leer la config para entender qué contribuciones se calculan.
export async function getPayrollConfigAction(
  companyId: string
): Promise<Result<PayrollConfigRow | null>> {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. NOM-A-01: verificar membresía
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "No autorizado" };

  // VIEWER no tiene acceso a detalles de configuración de nómina
  if (!canAccess(member.role, ROLES.ACCOUNTING))
    return { success: false, error: "Acceso denegado" };

  const cfg = await PayrollConfigService.getConfig(companyId);
  return { success: true, data: cfg };
}

// ── getPayrollConfigStatusAction — cualquier miembro (incluyendo VIEWER) ──────
// Retorna solo si el wizard fue completado. Usado para mostrar "Configuración pendiente".
export async function getPayrollConfigStatusAction(
  companyId: string
): Promise<Result<{ configured: boolean }>> {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  // 2. NOM-A-01: verificar membresía (NOM-A-06: sin auth en action = info disclosure)
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) return { success: false, error: "No autorizado" };

  const configured = await PayrollConfigService.isConfigured(companyId);
  return { success: true, data: { configured } };
}
