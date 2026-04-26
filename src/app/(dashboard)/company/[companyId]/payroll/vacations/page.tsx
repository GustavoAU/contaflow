// src/app/(dashboard)/company/[companyId]/payroll/vacations/page.tsx
// Fase NOM-D: Vacaciones y bono vacacional (Art. 190–192 LOTTT)

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import { VacationService } from "@/modules/payroll/services/VacationService";
import VacationAccordionList from "@/modules/payroll/components/VacationAccordionList";

type Props = { params: Promise<{ companyId: string }> };

export default async function VacationsPage({ params }: Props) {
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

  const employees = await EmployeeService.list(companyId, "ACTIVE");

  const employeeRecords = await Promise.all(
    employees.slice(0, 20).map(async (emp) => ({
      emp,
      records: await VacationService.listByEmployee(companyId, emp.id),
    }))
  );

  const recordsByEmployee = Object.fromEntries(
    employeeRecords.map(({ emp, records }) => [emp.id, records])
  );

  const employeeItems = employees.slice(0, 20).map((emp) => ({
    id: emp.id,
    fullName: emp.fullName,
    position: emp.position ?? null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8 px-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">Nómina</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Vacaciones</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Vacaciones</h1>
        <p className="mt-1 text-sm text-gray-500">
          Registro de vacaciones y bono vacacional por empleado (Art. 190–192 LOTTT).
          El monto se calcula automáticamente con el salario normal vigente.
        </p>
      </div>

      <section className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-xs text-blue-800 space-y-1">
        <p className="font-semibold">Referencia legal</p>
        <p>Art. 190: mínimo 15 días de vacaciones + 1 día adicional por año de servicio.</p>
        <p>Art. 192: bono vacacional mínimo 7 días + 1 día adicional por año de servicio.</p>
        <p>El monto = días × salario diario normal (salario mensual ÷ 30).</p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Empleados activos</h2>

        {employees.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
            No hay empleados activos registrados.
          </div>
        )}

        {employees.length > 0 && (
          <VacationAccordionList
            employees={employeeItems}
            recordsByEmployee={recordsByEmployee}
            companyId={companyId}
            canAdmin={isAdmin}
          />
        )}
      </section>
    </div>
  );
}
