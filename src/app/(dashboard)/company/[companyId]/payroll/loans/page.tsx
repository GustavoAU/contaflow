// src/app/(dashboard)/company/[companyId]/payroll/loans/page.tsx
// Préstamos a empleados con descuento automático en nómina.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import { EmployeeLoanService } from "@/modules/payroll/services/EmployeeLoanService";
import LoanTable from "@/modules/payroll/components/LoanTable";

type Props = { params: Promise<{ companyId: string }> };

export default async function LoansPage({ params }: Props) {
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

  const [employees, loans] = await Promise.all([
    EmployeeService.list(companyId, "ACTIVE"),
    EmployeeLoanService.list(companyId),
  ]);

  const employeeOptions = employees.map((e) => ({
    id: e.id,
    name: e.fullName,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}/payroll`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Nómina
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Préstamos a Empleados</h1>
        <p className="mt-1 text-sm text-gray-500">
          Las cuotas se descuentan automáticamente en cada proceso de nómina aprobado.
        </p>
      </div>

      <LoanTable
        companyId={companyId}
        initialLoans={loans}
        employees={employeeOptions}
        isAdmin={isAdmin}
      />
    </div>
  );
}
