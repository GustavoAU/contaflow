// src/app/(dashboard)/company/[companyId]/payables/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { getPayablesAction } from "@/modules/receivables/actions/receivable.actions";
import { AgingReportTable } from "@/modules/receivables/components/AgingReportTable";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function PayablesPage({ params }: Props) {
  const { companyId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}`);

  const result = await getPayablesAction(companyId);
  const report = result.success ? result.data : null;

  const contactosTabs = [
    { label: "Proveedores", href: `/company/${companyId}/vendors` },
    { label: "Clientes",    href: `/company/${companyId}/customers` },
    { label: "CxP",         href: `/company/${companyId}/payables` },
    { label: "CxC",         href: `/company/${companyId}/receivables` },
  ];

  return (
    <div className="mx-auto max-w-6xl py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cuentas por Pagar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Facturas de compra con saldo pendiente, ordenadas por antigüedad
        </p>
      </div>

      <ModuleTabs tabs={contactosTabs} color="emerald" />

      {!result.success ? (
        <p className="text-sm text-red-600">{result.error}</p>
      ) : report && report.rows.length === 0 ? (
        <div className="rounded-lg border bg-white p-10 text-center">
          <p className="text-sm text-zinc-400">No hay facturas de compra con saldo pendiente</p>
        </div>
      ) : report ? (
        <AgingReportTable report={report} companyId={companyId} />
      ) : null}
    </div>
  );
}
