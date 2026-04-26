// src/app/(dashboard)/company/[companyId]/payroll/profit-sharing/page.tsx
// Fase NOM-D: Utilidades (Art. 131–132 LOTTT)

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import { ProfitSharingService } from "@/modules/payroll/services/ProfitSharingService";
import ProfitSharingPanel from "@/modules/payroll/components/ProfitSharingPanel";

type Props = { params: Promise<{ companyId: string }> };

export default async function ProfitSharingPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  const canRead = canAccess(member.role, ROLES.ACCOUNTING);
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl py-8 px-4">
        <p className="text-sm text-gray-500">No tienes acceso a este módulo.</p>
      </div>
    );
  }

  const config = await prisma.payrollConfig.findUnique({ where: { companyId } });
  const employees = await EmployeeService.list(companyId, "ACTIVE");

  const employeeRecords = await Promise.all(
    employees.slice(0, 20).map(async (emp) => ({
      emp,
      records: await ProfitSharingService.listByEmployee(companyId, emp.id),
    }))
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8 px-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">Nómina</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Utilidades</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Utilidades</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cálculo y registro de utilidades por empleado (Art. 131–132 LOTTT).
          Los días de utilidades y el salario base se toman de la configuración de nómina.
        </p>
      </div>

      {config && (
        <section className="rounded-lg border border-green-100 bg-green-50 p-4 text-xs text-green-800 space-y-1">
          <p className="font-semibold">Configuración activa</p>
          <p>Días de utilidades configurados: <span className="font-mono font-semibold">{config.profitDays}</span> días</p>
          <p>El monto = días fraccionados × (salario promedio anual ÷ 30)</p>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Empleados activos</h2>

        {employees.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
            No hay empleados activos registrados.
          </div>
        )}

        <div className="space-y-3">
          {employeeRecords.map(({ emp, records }) => (
            <details key={emp.id} className="rounded-lg border overflow-hidden group">
              <summary className="flex items-center justify-between cursor-pointer px-4 py-3 hover:bg-gray-50 select-none">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{emp.fullName}</span>
                  <span className="text-xs text-gray-400">{emp.position}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {records.length} registro{records.length !== 1 ? "s" : ""}
                  </span>
                  <svg className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="px-4 py-4 border-t bg-white">
                <ProfitSharingPanel
                  companyId={companyId}
                  employeeId={emp.id}
                  initialRecords={records}
                  canAdmin={isAdmin}
                />
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
