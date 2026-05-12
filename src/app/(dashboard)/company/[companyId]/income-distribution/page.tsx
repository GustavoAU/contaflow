// src/app/(dashboard)/company/[companyId]/income-distribution/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { IncomeDistributionPageClient } from "./IncomeDistributionPageClient";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";

type Props = { params: Promise<{ companyId: string }> };

export default async function IncomeDistributionPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}`);

  // Cargar cuentas de la empresa para los selects
  const accountsResult = await getAccountsAction(companyId);
  const accounts = accountsResult.success
    ? accountsResult.data.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
    : [];

  // Cargar empresas a las que el usuario tiene acceso (para los destinatarios)
  const memberships = await prisma.companyMember.findMany({
    where: { userId },
    select: { company: { select: { id: true, name: true } } },
  });
  const companies = memberships.map((m) => m.company);

  return (
    <IncomeDistributionPageClient
      companyId={companyId}
      accounts={accounts}
      companies={companies}
    />
  );
}
