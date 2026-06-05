// src/app/(dashboard)/company/[companyId]/payroll/runs/[runId]/page.tsx
// Fase NOM-C: Detalle de proceso de nómina con líneas y aprobación

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollRunService } from "@/modules/payroll/services/PayrollRunService";
import { PayrollRunDetail } from "@/modules/payroll/components/PayrollRunDetail";
import { PayrollConfigService } from "@/modules/payroll/services/PayrollConfigService";
import { LegalThresholdService } from "@/modules/payroll/services/LegalThresholdService";

interface Props {
  params: Promise<{ companyId: string; runId: string }>;
}

export default async function PayrollRunDetailPage({ params }: Props) {
  const { companyId, runId } = await params;
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
        No tienes acceso a este módulo.
      </div>
    );
  }

  // NOM-C-01: getById ya incluye companyId en el where (IDOR guard)
  const [run, config] = await Promise.all([
    PayrollRunService.getById(companyId, runId),
    PayrollConfigService.getConfig(companyId),
  ]);
  if (!run) notFound();

  // IV: salario mínimo vigente al período para verificar topes IVSS/INCES/FAOV/RPE
  const [salaryMinDecimal, usdRateRow] = await Promise.all([
    LegalThresholdService.getActive(companyId, "SALARY_MIN_VES", new Date(run.periodStart)),
    prisma.exchangeRate.findFirst({
      where: { companyId, currency: "USD", date: { lte: new Date(run.periodEnd) } },
      orderBy: { date: "desc" },
      select: { rate: true },
    }),
  ]);
  const salaryMinCap = salaryMinDecimal?.toString() ?? null;

  const canAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  const currency = config?.paymentCurrency ?? "VES";
  const usdRate = usdRateRow?.rate?.toString() ?? null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/company/${companyId}/payroll/runs`}
          className="text-sm text-gray-500 hover:underline"
        >
          ← Procesos de Nómina
        </Link>
      </div>

      <PayrollRunDetail companyId={companyId} run={run} canAdmin={canAdmin} currency={currency} salaryMinCap={salaryMinCap} usdRate={usdRate} />
    </div>
  );
}
