// src/app/(dashboard)/company/[companyId]/payroll/reports/arc/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { ArcReportView } from "@/modules/payroll/components/ArcReportView";

type Props = { params: Promise<{ companyId: string }> };

export default async function ArcReportPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}/payroll`);

  // Cargar empleados activos server-side para el selector
  const employees = await prisma.employee.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8 px-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href={`/company/${companyId}/payroll`} className="hover:text-zinc-800">Nómina</Link>
          <span>›</span>
          <Link href={`/company/${companyId}/payroll/reports`} className="hover:text-zinc-800">Reportes</Link>
          <span>›</span>
          <span>ARC</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">ARC — Comprobante de Retención ISLR</h1>
        <p className="mt-1 text-sm text-gray-500">
          Decreto 1.808 Tarifa 1. Desgravamen único: 774 UT. Ingresos reales del año fiscal.
        </p>
      </div>
      <ArcReportView companyId={companyId} employees={employees} />
    </div>
  );
}
