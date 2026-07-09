// src/modules/company/actions/member.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { mapPrismaError } from "@/lib/prisma-errors";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { STEP_UP_CONFIG, reverificationError, type StepUpError } from "@/lib/step-up";
import * as MemberService from "../services/MemberService";
import {
  AddMemberSchema,
  UpdateMemberRoleSchema,
  RemoveMemberSchema,
} from "../schemas/member.schema";
import type { UserRole } from "@prisma/client";
import type { AddMemberInput, UpdateMemberRoleInput, RemoveMemberInput } from "../schemas/member.schema";

// ─── Tipos y helpers ──────────────────────────────────────────────────────────

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function toZodFieldErrors(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }
  return { success: false, error: "Datos inválidos", fieldErrors };
}

// ─── Listar miembros ──────────────────────────────────────────────────────────

export async function getMembersAction(
  companyId: string
): Promise<ActionResult<MemberService.MemberRow[]>> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ALL });
  if (!ctx.ok) return ctx.error;

  try {
    const members = await MemberService.listMembers(companyId);
    return { success: true, data: members };
  } catch (error) {
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Agregar miembro ─────────────────────────────────────────────────────────

export async function addMemberAction(
  input: AddMemberInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    const validated = AddMemberSchema.parse(input);

    const member = await MemberService.addMember(
      validated.companyId,
      validated.email,
      validated.role as UserRole,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: member.id } };
  } catch (error) {
    if (error instanceof z.ZodError) return toZodFieldErrors(error);
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Actualizar rol ───────────────────────────────────────────────────────────

export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
    });
    if (!ctx.ok) return ctx.error;

    const validated = UpdateMemberRoleSchema.parse(input);

    const updated = await MemberService.updateMemberRole(
      validated.companyId,
      validated.targetUserId,
      validated.role as UserRole,
      ctx.userId
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: { id: updated.id } };
  } catch (error) {
    if (error instanceof z.ZodError) return toZodFieldErrors(error);
    return { success: false, error: mapPrismaError(error) };
  }
}

// ─── Eliminar miembro ─────────────────────────────────────────────────────────

export async function removeMemberAction(
  input: RemoveMemberInput
): Promise<ActionResult<null> | StepUpError> {
  try {
    const ctx = await requireCompanyAction(input.companyId, {
      roles: ROLES.ADMIN_ONLY,
      limiter: limiters.fiscal,
      captureNet: true,
    });
    if (!ctx.ok) return ctx.error;

    // Q2-3: Step-up — re-verificación con 2do factor para eliminar miembro
    // ADR-041 D-4: check extra/más restrictivo DESPUÉS del guard central
    const { has } = await auth();
    if (!has({ reverification: STEP_UP_CONFIG })) {
      return reverificationError(STEP_UP_CONFIG);
    }

    const validated = RemoveMemberSchema.parse(input);

    await MemberService.removeMember(
      validated.companyId,
      validated.targetUserId,
      ctx.userId,
      ctx.ipAddress,
      ctx.userAgent
    );

    revalidatePath(`/company/${validated.companyId}/settings`);
    return { success: true, data: null };
  } catch (error) {
    if (error instanceof z.ZodError) return toZodFieldErrors(error);
    return { success: false, error: mapPrismaError(error) };
  }
}
