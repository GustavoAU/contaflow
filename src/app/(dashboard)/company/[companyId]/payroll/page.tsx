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

        {/* Admin: muestra wizard (editable aunque ya exista config) */}
        {isAdmin && (
          <PayrollWizard
            companyId={companyId}
            initial={config}
          />
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

            {/* Próximamente */}
            {[
              { label: "Cálculo de Nómina", desc: "Motor quincenal/mensual + recibo PDF" },
              { label: "Prestaciones Sociales", desc: "Garantía trimestral + intereses BCV" },
              { label: "Reportes Legales", desc: "IVSS, INCES, Banavih, ARC/ISLR" },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-lg border border-dashed bg-gray-50 p-4 opacity-60"
              >
                <p className="font-medium text-gray-700">{m.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{m.desc}</p>
                <span className="mt-2 inline-block rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                  Próximamente
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
