"use server";

// src/modules/settings/actions/accountant-config.actions.ts

import { z } from "zod";
import prisma from "@/lib/prisma";
import { ROLES } from "@/lib/auth-helpers";
import { limiters } from "@/lib/ratelimit";
import { requireCompanyAction } from "@/lib/action-guard";
import { revalidatePath } from "next/cache";

const AccountantConfigSchema = z.object({
  accountantName: z.string().max(150).optional(),
  accountantTitle: z.string().max(100).optional(),
  accountantCpcNumber: z.string().max(20).optional(),
});

export type AccountantConfig = {
  accountantName: string | null;
  accountantTitle: string | null;
  accountantCpcNumber: string | null;
};

export async function getAccountantConfigAction(
  companyId: string,
): Promise<{ success: true; data: AccountantConfig } | { success: false; error: string }> {
  const ctx = await requireCompanyAction(companyId, { roles: ROLES.ACCOUNTING });
  if (!ctx.ok) return ctx.error;

  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { accountantName: true, accountantTitle: true, accountantCpcNumber: true },
  });

  return {
    success: true,
    data: {
      accountantName: settings?.accountantName ?? null,
      accountantTitle: settings?.accountantTitle ?? null,
      accountantCpcNumber: settings?.accountantCpcNumber ?? null,
    },
  };
}

export async function saveAccountantConfigAction(
  companyId: string,
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await requireCompanyAction(companyId, {
    roles: ROLES.ADMIN_ONLY,
    limiter: limiters.fiscal,
  });
  if (!ctx.ok) return ctx.error;

  const parsed = AccountantConfigSchema.safeParse({
    accountantName: formData.get("accountantName") || undefined,
    accountantTitle: formData.get("accountantTitle") || undefined,
    accountantCpcNumber: formData.get("accountantCpcNumber") || undefined,
  });
  if (!parsed.success) return { success: false, error: "Datos inválidos" };

  await prisma.companySettings.upsert({
    where: { companyId },
    create: {
      companyId,
      accountantName: parsed.data.accountantName ?? null,
      accountantTitle: parsed.data.accountantTitle ?? null,
      accountantCpcNumber: parsed.data.accountantCpcNumber ?? null,
    },
    update: {
      accountantName: parsed.data.accountantName ?? null,
      accountantTitle: parsed.data.accountantTitle ?? null,
      accountantCpcNumber: parsed.data.accountantCpcNumber ?? null,
    },
  });

  revalidatePath(`/company/${companyId}/settings`);
  return { success: true };
}
