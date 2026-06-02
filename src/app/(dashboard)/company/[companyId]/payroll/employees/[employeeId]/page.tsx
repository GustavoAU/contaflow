// src/app/(dashboard)/company/[companyId]/payroll/employees/[employeeId]/page.tsx
// U-02: Vista consolidada — tabs historial salarial / vacaciones / préstamos / prestaciones
// U-08: Fechas en formato DD/MM/YYYY (fmtDate con locale es-VE)

import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { EmployeeService } from "@/modules/payroll/services/EmployeeService";
import { VacationService } from "@/modules/payroll/services/VacationService";
import { EmployeeLoanService } from "@/modules/payroll/services/EmployeeLoanService";
import { BenefitAccrualService } from "@/modules/payroll/services/BenefitAccrualService";
import { BenefitAdvanceService } from "@/modules/payroll/services/BenefitAdvanceService";
import SalaryHistoryPanel from "@/modules/payroll/components/SalaryHistoryPanel";
import VacationPanel from "@/modules/payroll/components/VacationPanel";
import LoanTable from "@/modules/payroll/components/LoanTable";
import BenefitBalancePanel from "@/modules/payroll/components/BenefitBalancePanel";
import { EmployeePortalTokenButton } from "@/modules/payroll/components/EmployeePortalTokenButton";
import { fmtDate } from "@/lib/format";

interface Props {
  params: Promise<{ companyId: string; employeeId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  TERMINATED: "Egresado",
};

const CONTRACT_LABELS: Record<string, string> = {
  INDEFINIDO: "Tiempo Indeterminado",
  DETERMINADO: "Tiempo Determinado",
  OBRA_DETERMINADA: "Por Obra Determinada",
};

const TABS = [
  { id: "salario", label: "Historial Salarial" },
  { id: "vacaciones", label: "Vacaciones" },
  { id: "prestamos", label: "Préstamos" },
  { id: "prestaciones", label: "Prestaciones" },
];

export default async function EmployeeDetailPage({ params, searchParams }: Props) {
  const { companyId, employeeId } = await params;
  const { tab: activeTab = "salario" } = await searchParams;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.WRITERS)) redirect(`/company/${companyId}/payroll`);

  const emp = await EmployeeService.getById(companyId, employeeId);
  if (!emp) notFound();

  const canWrite = canAccess(member.role, ROLES.ADMIN_ONLY);

  // U-02: fetch de datos para cada tab
  const [history, vacationRecords, loans, benefitBalance, advances] = await Promise.all([
    EmployeeService.getSalaryHistory(companyId, employeeId),
    VacationService.listByEmployee(companyId, employeeId),
    EmployeeLoanService.list(companyId, { employeeId }),
    BenefitAccrualService.getBalance(companyId, employeeId),
    BenefitAdvanceService.listAdvances(companyId, employeeId),
  ]);

  // Calcular años de servicio para vacaciones
  const today = new Date();
  const hireDate = new Date(emp.hireDate);
  const yearsOfService = Math.floor((today.getTime() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const vacationEntitlement = Math.max(15, 14 + yearsOfService);
  const currentYear = today.getFullYear();
  const vacationUsedThisYear = vacationRecords
    .filter((r) => r.periodYear === currentYear && !r.isFractional)
    .reduce((s, r) => s + Number(r.vacationDays), 0);

  // Employees list for LoanTable (only this employee)
  const employeeOptions = [{ id: emp.id, name: emp.fullName }];

  const tabHref = (id: string) =>
    `/company/${companyId}/payroll/employees/${employeeId}?tab=${id}`;

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/company/${companyId}/payroll`} className="hover:underline">
          Nómina
        </Link>
        <span>/</span>
        <Link href={`/company/${companyId}/payroll/employees`} className="hover:underline">
          Empleados
        </Link>
        <span>/</span>
        <span className="text-gray-800">{emp.fullName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{emp.fullName}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            CI {emp.cedula} · {emp.position}
            {emp.department ? ` · ${emp.department}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            emp.status === "ACTIVE"
              ? "bg-green-100 text-green-800"
              : emp.status === "TERMINATED"
              ? "bg-gray-100 text-gray-600"
              : "bg-yellow-100 text-yellow-800"
          }`}
        >
          {STATUS_LABELS[emp.status] ?? emp.status}
        </span>
      </div>

      {/* Datos del empleado */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-5 text-sm">
        <div>
          <dt className="text-xs font-medium text-gray-500">Tipo de contrato</dt>
          <dd className="mt-0.5 font-medium">{CONTRACT_LABELS[emp.contractType] ?? emp.contractType}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Régimen LOTTT</dt>
          <dd className="mt-0.5 font-medium">
            {emp.employeeRegime === "POST_2012" ? "Post-2012" : "Pre-1997 (mixto)"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-gray-500">Fecha de ingreso</dt>
          {/* U-08: DD/MM/YYYY formato venezolano */}
          <dd className="mt-0.5 font-medium">{fmtDate(emp.hireDate)}</dd>
        </div>
        {emp.terminationDate && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Fecha de egreso</dt>
            <dd className="mt-0.5 font-medium">{fmtDate(emp.terminationDate)}</dd>
          </div>
        )}
        {emp.email && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="mt-0.5">{emp.email}</dd>
          </div>
        )}
        {emp.phone && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Teléfono</dt>
            <dd className="mt-0.5">{emp.phone}</dd>
          </div>
        )}
        {emp.bankName && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Banco</dt>
            <dd className="mt-0.5">{emp.bankName}</dd>
          </div>
        )}
        {emp.bankAccount && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Cuenta</dt>
            <dd className="mt-0.5 font-mono text-xs">{emp.bankAccount}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-gray-500">Antigüedad</dt>
          <dd className="mt-0.5 font-medium">
            {yearsOfService} año{yearsOfService !== 1 ? "s" : ""}
          </dd>
        </div>
      </dl>

      {/* Portal del empleado */}
      {canWrite && (
        <div className="rounded-lg border bg-indigo-50 p-5">
          <p className="mb-2 text-sm font-medium text-indigo-800">
            Enlace de autoservicio para el empleado
          </p>
          <p className="mb-3 text-xs text-indigo-600">
            Genera un enlace seguro con validez de 30 días. El empleado puede ver sus recibos de pago, vacaciones y préstamos sin necesitar cuenta en la plataforma.
          </p>
          <EmployeePortalTokenButton
            companyId={companyId}
            employeeId={emp.id}
            employeeName={emp.fullName}
          />
        </div>
      )}

      {/* U-02: Tabs de vista consolidada */}
      <div>
        <nav className="flex border-b" aria-label="Secciones del empleado">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={tabHref(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="pt-4">
          {activeTab === "salario" && (
            <SalaryHistoryPanel
              companyId={companyId}
              employeeId={emp.id}
              history={history}
              canWrite={canWrite}
            />
          )}

          {activeTab === "vacaciones" && (
            <VacationPanel
              companyId={companyId}
              employeeId={emp.id}
              initialRecords={vacationRecords}
              canAdmin={canWrite}
              vacationEntitlement={vacationEntitlement}
              vacationUsedThisYear={vacationUsedThisYear}
              yearsOfService={yearsOfService}
            />
          )}

          {activeTab === "prestamos" && (
            <LoanTable
              companyId={companyId}
              initialLoans={loans}
              employees={employeeOptions}
              isAdmin={canWrite}
            />
          )}

          {activeTab === "prestaciones" && benefitBalance && (
            <BenefitBalancePanel
              balance={benefitBalance}
              initialAdvances={advances}
              canAdmin={canWrite}
            />
          )}
          {activeTab === "prestaciones" && !benefitBalance && (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-gray-500">
              No hay saldo de prestaciones acumulado para este empleado.
              Ejecuta la acumulación trimestral desde la sección de Prestaciones.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
