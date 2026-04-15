// src/app/(dashboard)/company/[companyId]/payroll/employees/page.tsx
// Fase NOM-B: Lista de empleados — SSR con guard de membresía

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import EmployeeList from "@/modules/payroll/components/EmployeeList";

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function EmployeesPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  // VIEWER no accede
  if (!canAccess(member.role, ROLES.WRITERS)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No tienes acceso al módulo de empleados.
      </div>
    );
  }

  const employees = await EmployeeService.list(companyId);
  const canWrite = canAccess(member.role, ROLES.ADMIN_ONLY);
  const activeCount = employees.filter((e) => e.status === "ACTIVE").length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Empleados</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {activeCount} empleado{activeCount !== 1 ? "s" : ""} activo
            {activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/company/${companyId}/payroll`}
            className="text-sm text-gray-500 hover:underline"
          >
            ← Nómina
          </Link>
          {canWrite && (
            <Link
              href={`/company/${companyId}/payroll/employees/new`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Nuevo empleado
            </Link>
          )}
        </div>
      </div>

      <EmployeeList companyId={companyId} employees={employees} canWrite={canWrite} />
    </div>
  );
}
