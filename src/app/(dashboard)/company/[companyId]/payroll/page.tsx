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
  const activeEmployeeCount = config && canReadEmployees
    ? await EmployeeService.countActive(companyId)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8 px-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nómina</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gestión de nómina según LOTTT, IVSS, INCES y Banavih.
        </p>
      </div>

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
              <Link
                href={`/company/${companyId}/payroll/employees`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Empleados</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {activeEmployeeCount !== null
                    ? `${activeEmployeeCount} empleado${activeEmployeeCount !== 1 ? "s" : ""} activo${activeEmployeeCount !== 1 ? "s" : ""}`
                    : "Gestión de empleados y contratos"}
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Empleados</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Conceptos — NOM-B disponible para ACCOUNTING */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/concepts`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Conceptos</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Catálogo de asignaciones y deducciones
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Conceptos</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Cálculo de Nómina — NOM-C */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/runs`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Cálculo de Nómina</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Motor quincenal/mensual + recibo PDF
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Cálculo de Nómina</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Prestaciones Sociales — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/benefits`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Prestaciones Sociales</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Garantía trimestral + intereses BCV
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Prestaciones Sociales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Vacaciones — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/vacations`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Vacaciones</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Registro y bono vacacional (Art. 190–192 LOTTT)
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Vacaciones</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Utilidades — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/profit-sharing`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Utilidades</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Cálculo anual/fraccionado (Art. 131–132 LOTTT)
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Utilidades</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Liquidaciones Finales — NOM-D */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/terminations`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Liquidaciones Finales</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Cálculo de egreso LOTTT
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Liquidaciones Finales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/reports`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Reportes Legales</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  IVSS, INCES, Banavih, ARC/ISLR
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Reportes Legales</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Préstamos a Empleados */}
            {canAccess(member.role, ROLES.ACCOUNTING) ? (
              <Link
                href={`/company/${companyId}/payroll/loans`}
                className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
              >
                <p className="font-medium text-gray-800">Préstamos</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Descuento automático en nómina
                </p>
              </Link>
            ) : (
              <div className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60">
                <p className="font-medium text-gray-700">Préstamos</p>
                <p className="mt-0.5 text-xs text-gray-500">Sin acceso</p>
              </div>
            )}

            {/* Topes Legales — Ítem 72 */}
            <Link
              href={`/company/${companyId}/payroll/legal-thresholds`}
              className="rounded-lg border p-4 hover:bg-gray-50 transition-colors"
            >
              <p className="font-medium text-gray-800">Topes Legales</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Salario mínimo y Unidad Tributaria por decreto
              </p>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
