// src/modules/bank-reconciliation/utils/bank-action-guard.ts
// Helpers compartidos entre banking.actions y auto-reconciliation.actions.
// ADR-006 D-1 / LL-009: IDOR guard — verificar membresía antes de toda mutación.

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";

export async function getAuthUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

export async function getMemberRole(
  userId: string,
  companyId: string,
): Promise<UserRole | null> {
  const member = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { role: true },
  });
  return member?.role ?? null;
}
