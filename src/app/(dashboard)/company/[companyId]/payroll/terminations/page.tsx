// src/app/(dashboard)/company/[companyId]/payroll/terminations/page.tsx
// Fase NOM-D: Listado de liquidaciones finales + acceso a nueva liquidación

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { TerminationService } from "@/modules/payroll/services/TerminationService";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import TerminationList from "@/modules/payroll/components/TerminationList";

type Props = { params: Promise<{ companyId: string }> };

export default async function TerminationsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const canRead = canAccess(member.role, ROLES.ACCOUNTING);
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl py-8 px-4">
        <p className="text-sm text-gray-500">No tienes acceso a este módulo.</p>
      </div>
    );
  }

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);

  const [terminations, employees] = await Promise.all([
    TerminationService.list(companyId),
    EmployeeService.list(companyId),
  ]);

  // Mapa id → nombre para mostrar en tabla
  const employeeNames: Record<string, string> = {};
  for (const emp of employees) {
    employeeNames[emp.id] = emp.fullName;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8 px-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">
          Nómina
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Liquidaciones Finales</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Liquidaciones Finales</h1>
          <p className="mt-1 text-sm text-gray-500">
            Cálculo y registro de pagos de egreso (LOTTT)
          </p>
        </div>
        {isAdmin && (
          <Link
            href={`/company/${companyId}/payroll/terminations/new`}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Nueva liquidación
          </Link>
        )}
      </div>

      <TerminationList
        companyId={companyId}
        terminations={terminations}
        employeeNames={employeeNames}
      />
    </div>
  );
}
