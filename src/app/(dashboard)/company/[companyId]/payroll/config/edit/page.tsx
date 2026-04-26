// src/app/(dashboard)/company/[companyId]/payroll/config/edit/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollConfigService } from "@/modules/payroll/services/PayrollConfigService";
import PayrollWizard from "@/modules/payroll/components/PayrollWizard";

type Props = { params: Promise<{ companyId: string }> };

export default async function PayrollConfigEditPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  // Solo ADMIN puede editar la configuración
  if (!canAccess(member.role, ROLES.ADMIN_ONLY)) {
    redirect(`/company/${companyId}/payroll`);
  }

  const [config, accounts] = await Promise.all([
    PayrollConfigService.getConfig(companyId),
    prisma.account.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8 px-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/company/${companyId}/payroll`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Nómina
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-700">Editar configuración</span>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuración de Nómina</h1>
        <p className="mt-1 text-sm text-gray-500">
          Modifica los parámetros de cálculo para tu empresa.
        </p>
      </div>
      <PayrollWizard companyId={companyId} initial={config} accounts={accounts} />
    </div>
  );
}
