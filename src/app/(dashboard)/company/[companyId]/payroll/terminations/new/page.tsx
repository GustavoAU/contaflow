// src/app/(dashboard)/company/[companyId]/payroll/terminations/new/page.tsx
// Fase NOM-D: Formulario de nueva liquidación (ADMIN_ONLY)

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import TerminationForm from "@/modules/payroll/components/TerminationForm";

type Props = { params: Promise<{ companyId: string }> };

export default async function NewTerminationPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    redirect(`/company/${companyId}/payroll/terminations`);
  }

  // Solo empleados activos pueden ser liquidados
  const employees = await EmployeeService.list(companyId, "ACTIVE");

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 px-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">Nómina</Link>
        <span>/</span>
        <Link href={`/company/${companyId}/payroll/terminations`} className="hover:text-gray-700">
          Liquidaciones
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Nueva</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nueva Liquidación Final</h1>
        <p className="mt-1 text-sm text-gray-500">
          Los montos se calculan automáticamente desde los registros del sistema.
        </p>
      </div>

      {employees.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
          No hay empleados activos. Registra empleados primero.
        </div>
      ) : (
        <TerminationForm
          companyId={companyId}
          employees={employees.map((e) => ({ id: e.id, fullName: e.fullName }))}
        />
      )}
    </div>
  );
}
