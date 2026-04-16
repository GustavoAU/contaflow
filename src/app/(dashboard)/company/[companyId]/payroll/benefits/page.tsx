// src/app/(dashboard)/company/[companyId]/payroll/benefits/page.tsx
// Fase NOM-D: Prestaciones Sociales — hub de acumulación trimestral, intereses BCV, tasas

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { BenefitAccrualService } from "@/modules/payroll/services/BenefitAccrualService";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import AccrueQuarterForm from "@/modules/payroll/components/AccrueQuarterForm";
import PostInterestForm from "@/modules/payroll/components/PostInterestForm";
import BcvRateForm from "@/modules/payroll/components/BcvRateForm";
import BcvRateList from "@/modules/payroll/components/BcvRateList";
import BenefitBalancePanel from "@/modules/payroll/components/BenefitBalancePanel";

type Props = { params: Promise<{ companyId: string }> };

export default async function BenefitsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const isAdmin = canAccess(member.role, ROLES.ADMIN_ONLY);
  const canRead = canAccess(member.role, ROLES.ACCOUNTING);
  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl py-8 px-4">
        <p className="text-sm text-gray-500">No tienes acceso a este módulo.</p>
      </div>
    );
  }

  // Cargar datos en paralelo
  const [employees, bcvRates] = await Promise.all([
    EmployeeService.list(companyId, "ACTIVE"),
    BenefitAccrualService.listBcvRates(companyId),
  ]);

  // Cargar saldos de los primeros 20 empleados activos
  const balances = await Promise.all(
    employees.slice(0, 20).map((emp) =>
      BenefitAccrualService.getBalance(companyId, emp.id).then((b) => ({ emp, balance: b }))
    )
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8 px-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:text-gray-700">
          Nómina
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Prestaciones Sociales</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Prestaciones Sociales</h1>
        <p className="mt-1 text-sm text-gray-500">
          Garantía trimestral (Art. 142 LOTTT) e intereses BCV (Art. 143 LOTTT)
        </p>
      </div>

      {/* Acciones de Admin */}
      {isAdmin && (
        <div className="space-y-6">
          {/* Acumulación trimestral */}
          <section className="rounded-lg border p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-1">
              Acumulación trimestral
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              5 días de salario integral por trimestre (Art. 142 LOTTT). Se procesa una vez por trimestre para todos los empleados activos.
            </p>
            <AccrueQuarterForm companyId={companyId} />
          </section>

          {/* Intereses BCV */}
          <section className="rounded-lg border p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-1">
              Intereses sobre prestaciones
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Intereses mensuales calculados automáticamente con la tasa BCV registrada para el mes seleccionado (Art. 143 LOTTT).
            </p>
            <PostInterestForm companyId={companyId} />
          </section>

          {/* Tasas BCV */}
          <section className="rounded-lg border p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-3">
              Tasas BCV registradas
            </h2>
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Registrar nueva tasa</h3>
              <BcvRateForm companyId={companyId} />
            </div>
            <BcvRateList rates={bcvRates} />
          </section>
        </div>
      )}

      {/* Saldos por empleado */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Saldos de prestaciones
        </h2>

        {employees.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
            No hay empleados activos registrados.
          </div>
        )}

        <div className="space-y-4">
          {balances.map(({ emp, balance }) => (
            <details
              key={emp.id}
              className="rounded-lg border overflow-hidden group"
            >
              <summary className="flex items-center justify-between cursor-pointer px-4 py-3 hover:bg-gray-50 select-none">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{emp.fullName}</span>
                  <span className="text-xs text-gray-400">{emp.position}</span>
                </div>
                <div className="flex items-center gap-4">
                  {balance ? (
                    <>
                      <span className="text-sm text-gray-600">
                        Garantía:{" "}
                        <span className="font-mono font-semibold">
                          {Number(balance.currentBalance).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                        </span>
                      </span>
                      {balance.isLiquidated && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          Liquidado
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Sin prestaciones</span>
                  )}
                  <svg className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="px-4 py-4 border-t bg-white">
                {balance ? (
                  <BenefitBalancePanel balance={balance} />
                ) : (
                  <p className="text-sm text-gray-500 italic">
                    Este empleado no tiene prestaciones registradas todavía.
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>

        {employees.length > 20 && (
          <p className="mt-3 text-xs text-gray-400 text-center">
            Mostrando los primeros 20 empleados. Usa el módulo de Empleados para ver prestaciones individuales.
          </p>
        )}
      </section>
    </div>
  );
}
