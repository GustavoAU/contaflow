// src/app/(dashboard)/company/[companyId]/payroll/employees/[employeeId]/page.tsx
// Fase NOM-B: Detalle de empleado con historial de salarios

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import SalaryHistoryPanel from "@/modules/payroll/components/SalaryHistoryPanel";

interface Props {
  params: Promise<{ companyId: string; employeeId: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  TERMINATED: "Egresado",
};

const CONTRACT_LABELS: Record<string, string> = {
  INDEFINIDO: "Tiempo Indeterminado",
  DETERMINADO: "Tiempo Determinado",
  OBRA_DETERMINADA: "Por Obra Determinada",
};

export default async function EmployeeDetailPage({ params }: Props) {
  const { companyId, employeeId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.WRITERS)) redirect(`/company/${companyId}/payroll`);

  const emp = await EmployeeService.getById(companyId, employeeId);
  if (!emp) notFound();

  const history = await EmployeeService.getSalaryHistory(companyId, employeeId);
  const canWrite = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:underline">
          Nómina
        </Link>
        <span>/</span>
        <Link href={`/company/${companyId}/payroll/employees`} className="hover:underline">
          Empleados
        </Link>
        <span>/</span>
        <span className="text-gray-800">{emp.fullName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{emp.fullName}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            CI {emp.cedula} · {emp.position}
            {emp.department ? ` · ${emp.department}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            emp.status === "ACTIVE"
              ? "bg-green-100 text-green-800"
              : emp.status === "TERMINATED"
              ? "bg-gray-100 text-gray-600"
              : "bg-yellow-100 text-yellow-800"
          }`}
        >
          {STATUS_LABELS[emp.status] ?? emp.status}
        </span>
      </div>

      {/* Datos del empleado */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-5 text-sm">
        <div>
          <dt className="text-xs font-medium text-gray-500">Tipo de contrato</dt>
          <dd className="mt-0.5 font-medium">{CONTRACT_LABELS[emp.contractType] ?? emp.contractType}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Régimen LOTTT</dt>
          <dd className="mt-0.5 font-medium">
            {emp.employeeRegime === "POST_2012" ? "Post-2012" : "Pre-1997 (mixto)"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Fecha de ingreso</dt>
          <dd className="mt-0.5 font-medium">{emp.hireDate}</dd>
        </div>
        {emp.terminationDate && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Fecha de egreso</dt>
            <dd className="mt-0.5 font-medium">{emp.terminationDate}</dd>
          </div>
        )}
        {emp.email && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="mt-0.5">{emp.email}</dd>
          </div>
        )}
        {emp.phone && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Teléfono</dt>
            <dd className="mt-0.5">{emp.phone}</dd>
          </div>
        )}
        {emp.bankName && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Banco</dt>
            <dd className="mt-0.5">{emp.bankName}</dd>
          </div>
        )}
        {emp.bankAccount && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Cuenta</dt>
            <dd className="mt-0.5 font-mono text-xs">{emp.bankAccount}</dd>
          </div>
        )}
      </dl>

      {/* Historial de salarios */}
      <SalaryHistoryPanel
        companyId={companyId}
        employeeId={emp.id}
        history={history}
        canWrite={canWrite}
      />
    </div>
  );
}
