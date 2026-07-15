// src/app/employee/[token]/page.tsx
// Portal del Empleado — Server Component.
// Verifica JWT, carga datos de empleado sin requerir sesión Clerk.

import { notFound } from "next/navigation";
import { verifyEmployeeToken } from "@/lib/employee-portal-jwt";
import prisma from "@/lib/prisma";
import Decimal from "decimal.js";

interface Props {
  params: Promise<{ token: string }>;
}

function fmt(amount: string | Decimal | null | undefined, fractionDigits = 2): string {
  if (amount === null || amount === undefined) return "—";
  const n = new Decimal(amount.toString());
  return n.toNumber().toLocaleString("es-VE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export default async function EmployeePortalPage({ params }: Props) {
  const { token } = await params;

  // 1. Verificar JWT
  const payload = verifyEmployeeToken(token);
  if (!payload) notFound();

  const { sub: employeeId, cid: companyId } = payload;

  // 2. Cargar datos del empleado (sin deletedAt — Employee usa status)
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      cedulaType: true,
      cedulaNumber: true,
      position: true,
      department: true,
      hireDate: true,
      email: true,
      phone: true,
      bankName: true,
      status: true,
    },
  });
  if (!employee) notFound();

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, rif: true },
  });
  if (!company) notFound();

  // 3. Últimas 12 nóminas APROBADAS — líneas del empleado con nombre de concepto
  const runs = await prisma.payrollRun.findMany({
    where: { companyId, status: "APPROVED" },
    orderBy: { periodEnd: "desc" },
    take: 12,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      lines: {
        where: { employeeId },
        select: {
          conceptType: true,
          amount: true,
          salarySnapshotCurrency: true,
          concept: { select: { name: true } },
        },
      },
    },
  });

  const payslips = runs
    .filter((r) => r.lines.length > 0)
    .map((r) => {
      const earnings = r.lines
        .filter((l) => l.conceptType === "EARNING")
        .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0));
      const deductions = r.lines
        .filter((l) => l.conceptType === "DEDUCTION")
        .reduce((s, l) => s.plus(new Decimal(l.amount.toString())), new Decimal(0));
      const net = earnings.minus(deductions);
      // Currency from first line's snapshot (all lines in same run share currency)
      const currency = r.lines[0]?.salarySnapshotCurrency ?? "VES";
      return { id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, currency, earnings, deductions, net, lines: r.lines };
    });

  // 4. Historial de vacaciones (últimos 5 registros)
  const vacations = await prisma.vacationRecord.findMany({
    where: { employeeId, companyId },
    orderBy: { periodYear: "desc" },
    take: 5,
    select: {
      periodYear: true,
      vacationDays: true,
      bonusDays: true,
      startDate: true,
      endDate: true,
      isFractional: true,
    },
  });

  // 5. Préstamo activo
  const loan = await prisma.employeeLoan.findFirst({
    where: { employeeId, companyId, status: "ACTIVE" },
    select: {
      totalAmount: true,
      remainingBalance: true,
      installments: true,
      installmentAmount: true,
      paidInstallments: true,
      currency: true,
    },
  });

  const fullName = `${employee.firstName} ${employee.lastName}`;
  const cedula = `${employee.cedulaType}-${employee.cedulaNumber}`;

  const STATUS_LABELS: Record<string, string> = {
    ACTIVE: "Activo",
    INACTIVE: "Inactivo",
    TERMINATED: "Egresado",
  };

  return (
    <div className="space-y-8">
      {/* Encabezado empresa */}
      <div className="rounded-lg border bg-white p-5 shadow-sm">
        <p className="text-xs text-gray-400">Empresa empleadora</p>
        <p className="mt-0.5 text-base font-semibold text-gray-900">{company.name}</p>
        {company.rif && <p className="text-sm text-gray-500">RIF: {company.rif}</p>}
      </div>

      {/* Datos del empleado */}
      <section aria-labelledby="emp-heading">
        <h2 id="emp-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Datos personales
        </h2>
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xl font-bold text-gray-900">{fullName}</p>
              <p className="mt-0.5 text-sm text-gray-500">{cedula}</p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                employee.status === "ACTIVE"
                  ? "bg-green-100 text-green-700"
                  : employee.status === "TERMINATED"
                  ? "bg-gray-100 text-gray-600"
                  : "bg-yellow-100 text-yellow-700"
              }`}
            >
              {STATUS_LABELS[employee.status] ?? employee.status}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-400">Cargo</dt>
              <dd className="font-medium">{employee.position}</dd>
            </div>
            {employee.department && (
              <div>
                <dt className="text-xs text-gray-400">Departamento</dt>
                <dd className="font-medium">{employee.department}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-gray-400">Fecha de ingreso</dt>
              <dd className="font-medium">{fmtDate(employee.hireDate)}</dd>
            </div>
            {employee.email && (
              <div>
                <dt className="text-xs text-gray-400">Email</dt>
                <dd>{employee.email}</dd>
              </div>
            )}
            {employee.phone && (
              <div>
                <dt className="text-xs text-gray-400">Teléfono</dt>
                <dd>{employee.phone}</dd>
              </div>
            )}
            {employee.bankName && (
              <div>
                <dt className="text-xs text-gray-400">Banco</dt>
                <dd>{employee.bankName}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* Recibos de pago */}
      <section aria-labelledby="payslip-heading">
        <h2 id="payslip-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Recibos de pago ({payslips.length > 0 ? `últimas ${payslips.length} nóminas aprobadas` : "sin registros"})
        </h2>
        {payslips.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-400">
            Sin recibos de pago disponibles.
          </div>
        ) : (
          <div className="space-y-3">
            {payslips.map((p) => (
              <details key={p.id} className="rounded-lg border bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between p-4 hover:bg-gray-50">
                  <div>
                    <span className="font-medium text-gray-900">
                      {fmtDate(p.periodStart)} — {fmtDate(p.periodEnd)}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">{p.currency}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Neto a cobrar</p>
                    <p className="font-semibold text-green-700">
                      {fmt(p.net)} {p.currency}
                    </p>
                  </div>
                </summary>
                <div className="border-t px-4 pb-4 pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400">
                        <th className="pb-1 text-left font-medium">Concepto</th>
                        <th className="pb-1 text-right font-medium">Asignaciones</th>
                        <th className="pb-1 text-right font-medium">Deducciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {p.lines.map((l, i) => (
                        <tr key={i} className="py-1">
                          <td className="py-1 text-gray-700">{l.concept.name}</td>
                          <td className="py-1 text-right font-mono text-green-700">
                            {l.conceptType === "EARNING" ? fmt(l.amount.toString()) : ""}
                          </td>
                          <td className="py-1 text-right font-mono text-red-600">
                            {l.conceptType === "DEDUCTION" ? fmt(l.amount.toString()) : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-gray-200 font-semibold">
                      <tr>
                        <td className="pt-2 text-gray-700">Total</td>
                        <td className="pt-2 text-right font-mono text-green-700">{fmt(p.earnings)}</td>
                        <td className="pt-2 text-right font-mono text-red-600">{fmt(p.deductions)}</td>
                      </tr>
                      <tr>
                        <td colSpan={2} className="pt-1 text-gray-700">Neto a cobrar</td>
                        <td className="pt-1 text-right font-mono font-bold text-gray-900">
                          {fmt(p.net)} {p.currency}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* Vacaciones */}
      <section aria-labelledby="vac-heading">
        <h2 id="vac-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Vacaciones
        </h2>
        {vacations.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-400">
            Sin registros de vacaciones.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left">Período</th>
                  <th scope="col" className="px-4 py-2 text-center">Días vacac.</th>
                  <th scope="col" className="px-4 py-2 text-center">Días bono</th>
                  <th scope="col" className="px-4 py-2 text-left">Inicio</th>
                  <th scope="col" className="px-4 py-2 text-left">Fin</th>
                  <th scope="col" className="px-4 py-2 text-center">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {vacations.map((v, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{v.periodYear}</td>
                    <td className="px-4 py-2 text-center font-mono">{fmt(v.vacationDays.toString(), 0)}</td>
                    <td className="px-4 py-2 text-center font-mono">{fmt(v.bonusDays.toString(), 0)}</td>
                    <td className="px-4 py-2">{fmtDate(v.startDate)}</td>
                    <td className="px-4 py-2">{fmtDate(v.endDate)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        v.isFractional ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"
                      }`}>
                        {v.isFractional ? "Fraccionadas" : "Completas"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Préstamo activo */}
      <section aria-labelledby="loan-heading">
        <h2 id="loan-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Préstamo activo
        </h2>
        {!loan ? (
          <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-gray-400">
            Sin préstamos activos.
          </div>
        ) : (
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-gray-400">Monto total</dt>
                <dd className="font-semibold">{fmt(loan.totalAmount.toString())} {loan.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Saldo pendiente</dt>
                <dd className="font-semibold text-red-600">{fmt(loan.remainingBalance.toString())} {loan.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Cuotas</dt>
                <dd className="font-semibold">
                  {loan.paidInstallments} / {loan.installments} pagadas
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Cuota mensual</dt>
                <dd className="font-semibold">{fmt(loan.installmentAmount.toString())} {loan.currency}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.round((loan.paidInstallments / loan.installments) * 100)}%` }}
                  role="progressbar"
                  aria-valuenow={loan.paidInstallments}
                  aria-valuemin={0}
                  aria-valuemax={loan.installments}
                  aria-label={`${loan.paidInstallments} de ${loan.installments} cuotas pagadas`}
                />
              </div>
              <p className="mt-1 text-right text-xs text-gray-400">
                {Math.round((loan.paidInstallments / loan.installments) * 100)}% pagado
              </p>
            </div>
          </div>
        )}
      </section>

      <p className="text-center text-xs text-gray-400">
        Enlace generado el {new Date().toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" })}. Válido por 30 días.
      </p>
    </div>
  );
}
