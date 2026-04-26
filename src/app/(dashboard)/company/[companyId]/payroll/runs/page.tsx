// src/app/(dashboard)/company/[companyId]/payroll/runs/page.tsx
// Fase NOM-C: Lista de procesos de nómina — SSR con guard de membresía

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollRunService } from "@/modules/payroll/services/PayrollRunService";
import { PayrollRunList } from "@/modules/payroll/components/PayrollRunList";

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function PayrollRunsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  if (!canAccess(member.role, ROLES.ACCOUNTING)) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No tienes acceso al módulo de procesos de nómina.
      </div>
    );
  }

  const runs = await PayrollRunService.list(companyId);
  const canAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Procesos de Nómina</h1>
          <p className="mt-0.5 text-sm text-gray-500">{runs.length} proceso{runs.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/company/${companyId}/payroll`} className="text-sm text-gray-500 hover:underline">
            ← Nómina
          </Link>
          {canAdmin && (
            <Link
              href={`/company/${companyId}/payroll/runs/new`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Nuevo Proceso
            </Link>
          )}
        </div>
      </div>

      <PayrollRunList
        companyId={companyId}
        runs={runs}
        canAdmin={canAdmin}
      />
    </div>
  );
}
