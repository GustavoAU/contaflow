// src/app/(dashboard)/company/[companyId]/payroll/reports/ivss/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { IvssReportView } from "@/modules/payroll/components/IvssReportView";

type Props = { params: Promise<{ companyId: string }> };

export default async function IvssReportPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}/payroll`);

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8 px-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href={`/company/${companyId}/payroll`} className="hover:text-zinc-800">Nómina</Link>
          <span>›</span>
          <Link href={`/company/${companyId}/payroll/reports`} className="hover:text-zinc-800">Reportes</Link>
          <span>›</span>
          <span>IVSS</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Planilla IVSS — Forma 14-02</h1>
        <p className="mt-1 text-sm text-gray-500">
          LSS Art. 62: Cotizaciones mensuales. Obrero 4% · Patronal 9% (techo 10 UT).
        </p>
      </div>
      <IvssReportView companyId={companyId} />
    </div>
  );
}
