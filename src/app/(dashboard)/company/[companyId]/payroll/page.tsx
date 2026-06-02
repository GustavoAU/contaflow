// src/app/(dashboard)/company/[companyId]/payroll/page.tsx
// Fase NOM-A/B: Nómina — hub principal
// NOM-A-05: ADMIN_ONLY puede editar la config; otros roles ven la config en modo lectura.
// NOM-A-01: companyId verificado via companyMember.findFirst antes de cualquier query.
// NOM-B: Módulos Empleados y Conceptos ahora disponibles (config requerida).

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { PayrollConfigService } from "@/modules/payroll/services/PayrollConfigService";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import PayrollWizard from "@/modules/payroll/components/PayrollWizard";
import PayrollConfigSummary from "@/modules/payroll/components/PayrollConfigSummary";
import { NavigationCard } from "@/components/ui/NavigationCard";
import PayrollCompliancePanel from "@/modules/payroll/components/PayrollCompliancePanel";

type Props = { params: Promise<{ companyId: string }> };

export default async function PayrollPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // NOM-A-01: verificar membresía server-side
  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  const canReadConfig = canAccess(member.role, ROLES.ACCOUNTING);

  // Solo leer config si el rol tiene acceso
  const config = canReadConfig
    ? await PayrollConfigService.getConfig(companyId)
    : null;

  const canReadEmployees = canAccess(member.role, ROLES.WRITERS);
  const canReadAccounting = canAccess(member.role, ROLES.ACCOUNTING);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);

  const [
    activeEmployeeCount,
    draftRunsCount,
    activeLoansCount,
    benefitLinesThisQuarter,
    benefitBalancesActive,
    vacationsThisYear,
    profitSharingThisYear,
  ] = await Promise.all([
    config && canReadEmployees ? EmployeeService.countActive(companyId) : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.payrollRun.count({ where: { companyId, status: "DRAFT" } })
      : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.employeeLoan.count({ where: { companyId, status: "ACTIVE" } })
      : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.benefitAccrualLine.count({
          where: { companyId, type: "QUARTERLY_ACCRUAL", year: currentYear, quarter: currentQuarter },
        })
      : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.benefitBalance.count({ where: { companyId, isLiquidated: false } })
      : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.vacationRecord.count({ where: { companyId, periodYear: currentYear, isFractional: false } })
      : Promise.resolve(null),
    config && canReadAccounting
      ? prisma.profitSharingRecord.count({ where: { companyId, fiscalYear: currentYear, isFractional: false } })
      : Promise.resolve(null),
  ]);

  const benefitsGap =
    benefitBalancesActive !== null && benefitLinesThisQuarter !== null
      ? benefitBalancesActive - benefitLinesThisQuarter
      : null;

  // U-05: datos para panel de cumplimiento
  const [latestBcvBenefitRate, latestThreshold, latestExchangeRate] = config && canReadAccounting
    ? await Promise.all([
        prisma.bcvBenefitRate.findFirst({ where: { companyId, year: currentYear }, select: { id: true } }),
        prisma.legalThreshold.findFirst({ where: { companyId }, orderBy: { effectiveFrom: "desc" }, select: { effectiveFrom: true } }),
        prisma.exchangeRate.findFirst({ where: { companyId, currency: "USD" }, orderBy: { date: "desc" }, select: { date: true } }),
      ])
    : [null, null, null];

  // Threshold desactualizado: si tiene más de 90 días sin actualizar
  const thresholdAge = latestThreshold
    ? Math.floor((Date.now() - new Date(latestThreshold.effectiveFrom).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const exchangeRateAge = latestExchangeRate
    ? Math.floor((Date.now() - new Date(latestExchangeRate.date).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8 px-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nómina</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gestión de nómina según LOTTT, IVSS, INCES y Banavih.
        </p>
      </div>

      {/* U-05: Panel de cumplimiento legal */}
      {config && canReadAccounting && (
        <PayrollCompliancePanel
          companyId={companyId}
          checks={[
            {
              label: "Salario mínimo / Topes Legales",
              status: !latestThreshold
                ? "red"
                : thresholdAge !== null && thresholdAge > 120
                  ? "amber"
                  : "green",
              detail: !latestThreshold
                ? "Sin topes registrados — configura el salario mínimo vigente."
                : thresholdAge !== null && thresholdAge > 120
                  ? `Último registro hace ${thresholdAge} días — verifica si hubo decreto presidencial reciente.`
                  : `Actualizado (hace ${thresholdAge} días).`,
              href: "/payroll/legal-thresholds",
              hrefLabel: "Configurar",
            },
            {
              label: "Tasa BCV intereses prestaciones",
              status: !latestBcvBenefitRate ? "amber" : "green",
              detail: !latestBcvBenefitRate
                ? `Sin tasa BCV registrada para ${currentYear} — necesaria para calcular intereses del Art. 143 LOTTT.`
                : `Registrada para ${currentYear}.`,
              href: "/payroll/benefits",
              hrefLabel: "Registrar",
            },
            {
              label: `Prestaciones sociales — Q${currentQuarter}/${currentYear}`,
              status:
                benefitsGap === null
                  ? "gray"
                  : benefitsGap > 0
                    ? "amber"
                    : "green",
              detail:
                benefitsGap === null
                  ? "Sin datos."
                  : benefitsGap > 0
                    ? `${benefitsGap} empleado${benefitsGap !== 1 ? "s" : ""} sin acumulación trimestral Q${currentQuarter} — Art. 143 LOTTT.`
                    : `Todos los empleados acumulados para Q${currentQuarter}.`,
              href: "/payroll/benefits",
              hrefLabel: "Acumular",
            },
            {
              label: "Tasa de cambio USD/VES",
              status:
                !latestExchangeRate
                  ? "gray"
                  : exchangeRateAge !== null && exchangeRateAge > 30
                    ? "amber"
                    : "green",
              detail: !latestExchangeRate
                ? "Sin tasa USD registrada — necesaria para nómina en dólares."
                : exchangeRateAge !== null && exchangeRateAge > 30
                  ? `Última tasa hace ${exchangeRateAge} días — actualiza la tasa BCV para reflejar correctamente los salarios USD.`
                  : `Tasa actualizada (hace ${exchangeRateAge} días).`,
              href: "/accounting/exchange-rates",
              hrefLabel: "Actualizar",
            },
            {
              label: "Procesos de nómina en borrador",
              status: draftRunsCount !== null && draftRunsCount > 0 ? "amber" : "green",
              detail:
                draftRunsCount === null
                  ? "Sin datos."
                  : draftRunsCount > 0
                    ? `${draftRunsCount} nómina${draftRunsCount !== 1 ? "s" : ""} en borrador sin aprobar.`
                    : "No hay borradores pendientes de aprobación.",
              href: "/payroll/runs",
              hrefLabel: "Ver",
            },
          ]}
        />
      )}

      {/* Configuración de Nómina */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Configuración de Nómina</h2>
          {config && (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
              Configurada
            </span>
          )}
          {!config && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Pendiente
            </span>
          )}
        </div>

        {/* Admin sin config: muestra wizard */}
        {isAdmin && !config && (
          <PayrollWizard
            companyId={companyId}
            initial={null}
          />
        )}

        {/* Admin con config: muestra resumen + enlace para editar */}
        {isAdmin && config && (
          <div className="space-y-3">
            <PayrollConfigSummary cfg={config} />
            <Link
              href={`/company/${companyId}/payroll/config/edit`}
              className="inline-block rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Editar configuración
            </Link>
          </div>
        )}

        {/* No-admin con acceso de lectura: muestra resumen */}
        {!isAdmin && canReadConfig && config && (
          <PayrollConfigSummary cfg={config} />
        )}

        {/* No-admin con acceso de lectura: config aún no existe */}
        {!isAdmin && canReadConfig && !config && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
            La configuración de nómina aún no ha sido completada por el Administrador.
          </p>
        )}

        {/* VIEWER: sin acceso a configuración */}
        {!canReadConfig && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
            No tienes acceso para ver la configuración de nómina.
          </p>
        )}
      </section>

      {/* Módulos de Nómina */}
      {config && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Módulos de Nómina</h2>
          <div className="grid grid-cols-2 gap-3">
            {/* Empleados — NOM-B disponible */}
            {canReadEmployees ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/employees`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Empleados</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {activeEmployeeCount !== null
                    ? `${activeEmployeeCount} empleado${activeEmployeeCount !== 1 ? "s" : ""} activo${activeEmployeeCount !== 1 ? "s" : ""}`
                    : "Gestión de empleados y contratos"}
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Empleados</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Conceptos — NOM-B disponible para ACCOUNTING */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/concepts`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Conceptos</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Catálogo de asignaciones y deducciones
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Conceptos</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Cálculo de Nómina — NOM-C */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/runs`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">Cálculo de Nómina</p>
                  {draftRunsCount !== null && draftRunsCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {draftRunsCount} en borrador
                    </span>
                  ) : draftRunsCount === 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-green-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Al día
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Motor quincenal/mensual + recibo PDF
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Cálculo de Nómina</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Prestaciones Sociales — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/benefits`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">Prestaciones Sociales</p>
                  {benefitsGap !== null && benefitsGap > 0 ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {benefitsGap} sin calcular Q{currentQuarter}
                    </span>
                  ) : benefitsGap === 0 && (benefitBalancesActive ?? 0) > 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-green-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Al día Q{currentQuarter}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Garantía trimestral + intereses BCV
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Prestaciones Sociales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Vacaciones — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/vacations`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">Vacaciones</p>
                  {vacationsThisYear !== null && vacationsThisYear > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                      {vacationsThisYear} en {currentYear}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Registro y bono vacacional (Art. 190–192 LOTTT)
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Vacaciones</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Utilidades — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/profit-sharing`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">Utilidades</p>
                  {profitSharingThisYear !== null && profitSharingThisYear > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                      {profitSharingThisYear} calculadas
                    </span>
                  ) : profitSharingThisYear === 0 && currentYear === now.getFullYear() && now.getMonth() >= 9 ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Pendiente {currentYear}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Cálculo anual/fraccionado (Art. 131–132 LOTTT)
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Utilidades</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Liquidaciones Finales — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/terminations`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Liquidaciones Finales</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Cálculo de egreso LOTTT
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Liquidaciones Finales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/reports`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Reportes Legales</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  IVSS, INCES, Banavih, ARC/ISLR
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Reportes Legales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Préstamos a Empleados */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <NavigationCard
                href={`/company/${companyId}/payroll/loans`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">Préstamos</p>
                  {activeLoansCount !== null && activeLoansCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                      {activeLoansCount} activo{activeLoansCount !== 1 ? "s" : ""}
                    </span>
                  ) : activeLoansCount === 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
                      Ninguno
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Descuento automático en nómina
                </p>
              </NavigationCard>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Préstamos</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Topes Legales — Ítem 72 */}
            <NavigationCard
              href={`/company/${companyId}/payroll/legal-thresholds`}
              className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
            >
              <p className="font-medium text-gray-800">Topes Legales</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Salario mínimo y Unidad Tributaria por decreto
              </p>
            </NavigationCard>
          </div>
        </section>
      )}
    </div>
  );
}
