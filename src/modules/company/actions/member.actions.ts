// src/modules/company/actions/member.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { checkRateLimit, limiters } from "@/lib/ratelimit";
import * as MemberService from "../services/MemberService";
import {
  AddMemberSchema,
  UpdateMemberRoleSchema,
  RemoveMemberSchema,
} from "../schemas/member.schema";
import type { UserRole } from "@prisma/client";
import type { AddMemberInput, UpdateMemberRoleInput, RemoveMemberInput } from "../schemas/member.schema";

// ─── Tipo de respuesta estándar ───────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

// ─── Listar miembros ──────────────────────────────────────────────────────────

export async function getMembersAction(
  companyId: string
): Promise<ActionResult<MemberService.MemberRow[]>> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "No autorizado" };

  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!member || !canAccess(member.role, ROLES.ALL)) {
    return { success: false, error: "No autorizado" };
  }

  try {
    const members = await MemberService.listMembers(companyId);
    return { success: true, data: members };
  } catch (error) {
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al obtener los miembros" };
  }
}

// ─── Agregar miembro ─────────────────────────────────────────────────────────

export async function addMemberAction(
  input: AddMemberInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const validated = AddMemberSchema.parse(input);

    const actor = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!actor) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(actor.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo Administrador o Propietario puede gestionar miembros." };
    }

    const h = await headers();
    const ipAddress =
      h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    const member = await MemberService.addMember(
      validated.companyId,
      validated.email,
      validated.role as UserRole,
      userId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: member.id } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos inválidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al agregar el miembro" };
  }
}

// ─── Actualizar rol ───────────────────────────────────────────────────────────

export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const validated = UpdateMemberRoleSchema.parse(input);

    const actor = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!actor) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(actor.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo Administrador o Propietario puede gestionar miembros." };
    }

    const updated = await MemberService.updateMemberRole(
      validated.companyId,
      validated.targetUserId,
      validated.role as UserRole,
      userId
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: updated.id } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos inválidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al actualizar el rol" };
  }
}

// ─── Eliminar miembro ─────────────────────────────────────────────────────────

export async function removeMemberAction(
  input: RemoveMemberInput
): Promise<ActionResult<null>> {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "No autorizado" };

    const rl = await checkRateLimit(userId, limiters.fiscal);
    if (!rl.allowed) return { success: false, error: rl.error };

    const validated = RemoveMemberSchema.parse(input);

    const actor = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: validated.companyId } },
    });
    if (!actor) return { success: false, error: "Empresa no encontrada" };
    if (!canAccess(actor.role, ROLES.ADMIN_ONLY)) {
      return { success: false, error: "Solo Administrador o Propietario puede gestionar miembros." };
    }

    const h = await headers();
    const ipAddress =
      h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = (h.get("user-agent") ?? "").slice(0, 512) || null;

    await MemberService.removeMember(
      validated.companyId,
      validated.targetUserId,
      userId,
      ipAddress,
      userAgent
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: null };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".");
        if (!fieldErrors[path]) fieldErrors[path] = [];
        fieldErrors[path].push(issue.message);
      }
      return { success: false, error: "Datos inválidos", fieldErrors };
    }
    if (error instanceof Error) return { success: false, error: error.message };
    return { success: false, error: "Error al eliminar el miembro" };
  }
}
