// src/app/(dashboard)/company/[companyId]/payroll/runs/[runId]/page.tsx
// Fase NOM-C: Detalle de proceso de nómina con líneas y aprobación

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollRunService } from "@/modules/payroll/services/PayrollRunService";
import { PayrollRunDetail } from "@/modules/payroll/components/PayrollRunDetail";
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
  // La guardia de obsolescencia se resuelve en el servidor: es una lectura y
  // debe estar YA en pantalla cuando aparece el boton de aprobar.
  const [run, staleness] = await Promise.all([
    PayrollRunService.getById(companyId, runId),
    PayrollRunService.getStaleSignals(companyId, runId),
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
  // La moneda del proceso es la del PROCESO, no la de `PayrollConfig`: desde
  // H-A la ranura es (período + moneda) y una empresa puede tener procesos en
  // VES y en USD del mismo período. `PayrollConfig.paymentCurrency` es un
  // valor de la empresa que no cambia por proceso — usarlo aquí mostraba "$"
  // en un proceso en bolívares con asiento ya aprobado, sólo porque la
  // configuración de la empresa dice USD.
  const currency = run.currencySegment;
  const usdRate = usdRateRow?.rate?.toString() ?? null;

  // Conceptos que el contador puede agregar a mano sobre el borrador. Se excluyen
  // los que calcula la propia nómina: agregarlos duplicaría lo ya computado.
  const CALCULADOS = new Set([
    "SAL_BASE", "IVSS_OBR", "IVSS_PAT", "INCES_OBR", "INCES_PAT",
    "FAOV_OBR", "FAOV_PAT", "RPE_OBR", "RPE_PAT",
    "HE_DIURNA", "HE_NOCTURNA", "PRESTAMO_EMP",
  ]);
  const manualConcepts = canAdmin && run.status === "DRAFT"
    ? (await prisma.payrollConcept.findMany({
        where: { companyId, isActive: true },
        select: { id: true, code: true, name: true, type: true, salaryNature: true },
        orderBy: { name: "asc" },
      }))
        .filter((c) => !CALCULADOS.has(c.code))
        .map(({ id, name, type, salaryNature }) => ({ id, name, type, salaryNature }))
    : [];

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

      <PayrollRunDetail companyId={companyId} run={run} canAdmin={canAdmin} currency={currency} salaryMinCap={salaryMinCap} usdRate={usdRate} manualConcepts={manualConcepts} staleness={staleness} />
    </div>
  );
}
