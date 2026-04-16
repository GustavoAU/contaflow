// src/app/(dashboard)/company/[companyId]/payroll/terminations/[terminationId]/page.tsx
// Fase NOM-D: Detalle de liquidación — vista + edición DRAFT + finalización

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { TerminationService } from "@/modules/payroll/services/TerminationService";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import TerminationDetail from "@/modules/payroll/components/TerminationDetail";

type Props = { params: Promise<{ companyId: string; terminationId: string }> };

export default async function TerminationDetailPage({ params }: Props) {
  const { companyId, terminationId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const canRead = canAccess(member.role, ROLES.ACCOUNTING);
  if (!canRead) redirect(`/company/${companyId}/payroll`);

  const termination = await TerminationService.getById(companyId, terminationId);
  if (!termination) notFound();

  // Resolver nombre del empleado
  const employee = await EmployeeService.getById(companyId, termination.employeeId);
  const employeeName = employee
    ? `${employee.firstName} ${employee.lastName}`
    : termination.employeeId;

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8 px-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">Nómina</Link>
        <span>/</span>
        <Link href={`/company/${companyId}/payroll/terminations`} className="hover:text-gray-700">
          Liquidaciones
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{employeeName}</span>
      </div>

      <TerminationDetail
        companyId={companyId}
        termination={termination}
        employeeName={employeeName}
        canAdmin={isAdmin}
      />
    </div>
  );
}
