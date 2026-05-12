import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { CajaCajaPageClient } from "./CajaCajaPageClient";

type Props = { params: Promise<{ companyId: string }> };

export default async function CajaCajaPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member || !canAccess(member.role, ROLES.WRITERS)) redirect(`/company/${companyId}`);

  const accountsResult = await getAccountsAction(companyId);
  const accounts = accountsResult.success
    ? accountsResult.data.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }))
    : [];

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <CajaCajaPageClient
      companyId={companyId}
      accounts={accounts}
      isAdmin={isAdmin}
    />
  );
}
