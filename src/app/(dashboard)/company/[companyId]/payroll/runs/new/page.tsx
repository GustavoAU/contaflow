// src/app/(dashboard)/company/[companyId]/payroll/runs/new/page.tsx
// Fase NOM-C: Formulario para crear nuevo proceso de nómina — ADMIN_ONLY

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollRunForm } from "@/modules/payroll/components/PayrollRunForm";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function NewPayrollRunPage({ params }: Props) {
  const { companyId } = await params;
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

  const activeEmployeeCount = await EmployeeService.countActive(companyId);

  return (
    <div className="p-6 max-w-2xl">
      <PayrollRunForm companyId={companyId} activeEmployeeCount={activeEmployeeCount} />
    </div>
  );
}
