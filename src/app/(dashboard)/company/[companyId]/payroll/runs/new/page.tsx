// src/app/(dashboard)/company/[companyId]/payroll/runs/new/page.tsx
// Fase NOM-C: Formulario para crear nuevo proceso de nómina — ADMIN_ONLY

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollRunForm } from "@/modules/payroll/components/PayrollRunForm";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import { PrerequisiteGuide } from "@/components/guides/PrerequisiteGuide";

interface Props {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}

export default async function NewPayrollRunPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { start, end } = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Solo el Administrador puede crear procesos de nómina.
      </div>
    );
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const [activeEmployeeCount, salMinThreshold, bcvRateForMonth, employees] = await Promise.all([
    EmployeeService.countActive(companyId),
    prisma.legalThreshold.findFirst({
      where: { companyId, type: "SALARY_MIN_VES" },
      orderBy: { effectiveFrom: "desc" },
      select: { value: true, effectiveFrom: true },
    }),
    prisma.bcvBenefitRate.findFirst({
      where: { companyId, year: currentYear, month: currentMonth },
      select: { id: true },
    }),
    // Con TODAS las vigencias del sueldo: el calculador BLOQUEA las nóminas de
    // monedas mixtas (C-01) porque los totales no serían de ninguna de las dos,
    // así que el formulario tiene que dejar separar por moneda — y para eso
    // necesita la moneda que regirá el período que se elija ahí, no la última
    // registrada. Sin `take: 1`: son una fila por cambio de sueldo.
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true, firstName: true, lastName: true,
        salaryHistory: {
          orderBy: { effectiveFrom: "desc" },
          select: { effectiveFrom: true, currency: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  if (activeEmployeeCount === 0) {
    return (
      <div className="p-6 max-w-lg">
        <PrerequisiteGuide type="employees" companyId={companyId} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <PayrollRunForm
        companyId={companyId}
        activeEmployeeCount={activeEmployeeCount}
        initialStart={start}
        initialEnd={end}
        salMinLastUpdate={salMinThreshold?.effectiveFrom.toISOString() ?? null}
        salMinValue={salMinThreshold?.value.toString() ?? null}
        hasBcvRateForMonth={!!bcvRateForMonth}
        employees={employees.map((e) => ({
          id: e.id,
          name: `${e.lastName}, ${e.firstName}`,
          // `effectiveFrom` es @db.Date (medianoche UTC): se serializa con
          // getters UTC, que un Date local corre el día hacia atrás en Venezuela.
          salaries: e.salaryHistory.map((s) => ({
            from: s.effectiveFrom.toISOString().slice(0, 10),
            currency: s.currency,
          })),
        }))}
      />
    </div>
  );
}
