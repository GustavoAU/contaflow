// src/app/(dashboard)/company/[companyId]/budgets/page.tsx
// Q3-3: Presupuestos y Proyecciones — page (Server Component).

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { BudgetService } from "@/modules/budgets/services/BudgetService";
import { CashFlowProjectionService } from "@/modules/budgets/services/CashFlowProjectionService";
import { BudgetPageClient } from "./BudgetPageClient";

type Props = { params: Promise<{ companyId: string }> };

export const metadata = { title: "Presupuestos y Proyecciones — ContaFlow" };

export default async function BudgetsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ALL)) redirect("/");

  const canWrite  = canAccess(member.role, ROLES.WRITERS);
  const canDelete = canAccess(member.role, ROLES.ADMIN_ONLY);

  const [budgets, cashFlow, accounts] = await Promise.all([
    BudgetService.list(companyId),
    CashFlowProjectionService.project(companyId),
    prisma.account.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);

  return (
    <BudgetPageClient
      companyId={companyId}
      initialBudgets={budgets}
      initialCashFlow={cashFlow}
      accounts={accounts}
      canWrite={canWrite}
      canDelete={canDelete}
    />
  );
}
