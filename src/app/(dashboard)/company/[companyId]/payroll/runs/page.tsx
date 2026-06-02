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

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentQuarter = Math.ceil(currentMonth / 3);

  const [runs, activeEmpCount, currentQAccrualCount] = await Promise.all([
    PayrollRunService.list(companyId),
    prisma.employee.count({ where: { companyId, status: "ACTIVE" } }),
    prisma.benefitAccrualLine.count({
      where: {
        companyId,
        type: "QUARTERLY_ACCRUAL",
        year: currentYear,
        quarter: currentQuarter,
      },
    }),
  ]);

  const canAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  // C-03: mostrar banner si hay empleados activos y Q aún no fue acumulado (Art. 142 LOTTT)
  const showAccrualBanner = activeEmpCount > 0 && currentQAccrualCount === 0;

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

      {/* C-03: Alerta prestaciones sociales Q pendiente (Art. 142 LOTTT) */}
      {showAccrualBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="font-medium">
              Q{currentQuarter}-{currentYear} sin acumular — obligación Art. 142 LOTTT
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              La garantía de prestaciones de este trimestre (5 días de salario integral por trimestre) no ha sido registrada.
              Esto genera un pasivo laboral no reconocido en libros.{" "}
              <Link
                href={`/company/${companyId}/payroll/benefits`}
                className="underline hover:text-amber-900"
              >
                Ir a Prestaciones Sociales →
              </Link>
            </p>
          </div>
        </div>
      )}

      <PayrollRunList
        companyId={companyId}
        runs={runs}
        canAdmin={canAdmin}
      />
    </div>
  );
}
