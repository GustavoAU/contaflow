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

  const [activeEmployeeCount, salMinThreshold, bcvRateForMonth] = await Promise.all([
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
  ]);

  if (activeEmployeeCount === 0) {
    return (
      <div className="p-6 max-w-lg">
        <PrerequisiteGuide type="employees" companyId={companyId} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <PayrollRunForm
        companyId={companyId}
        activeEmployeeCount={activeEmployeeCount}
        initialStart={start}
        initialEnd={end}
        salMinLastUpdate={salMinThreshold?.effectiveFrom.toISOString() ?? null}
        salMinValue={salMinThreshold?.value.toString() ?? null}
        hasBcvRateForMonth={!!bcvRateForMonth}
      />
    </div>
  );
}
