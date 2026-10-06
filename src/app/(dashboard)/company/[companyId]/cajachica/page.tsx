import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { listEmployeesAction } from "@/modules/payroll/actions/employee.actions";
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

  const [accountsResult, employeesResult] = await Promise.all([
    // SPEC-012: sin `onlyPostable`. Los cuatro formularios de cuenta (crear caja, depósito, gasto y
    // cierre) reciben también los títulos como encabezados no elegibles y deciden por `isPostable`.
    getAccountsAction(companyId),
    listEmployeesAction(companyId),
  ]);

  // Solo lo que los selectores necesitan (no el registro completo de Prisma) viaja al cliente.
  const accounts = accountsResult.success
    ? accountsResult.data.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
        isPostable: a.isPostable,
      }))
    : [];

  const employees = employeesResult.success
    ? employeesResult.data.map((e) => ({ id: e.id, name: e.fullName, status: e.status }))
    : [];

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <CajaCajaPageClient
      companyId={companyId}
      accounts={accounts}
      employees={employees}
      isAdmin={isAdmin}
    />
  );
}
