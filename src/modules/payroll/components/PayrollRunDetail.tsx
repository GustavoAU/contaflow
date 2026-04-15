"use client";

// src/modules/payroll/components/PayrollRunDetail.tsx
// Fase NOM-C: detalle de un proceso de nómina con líneas por empleado

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PayrollRunDetailRow } from "../services/PayrollRunService";
import { approvePayrollRunAction } from "../actions/payroll-run.actions";

interface Props {
  companyId: string;
  run: PayrollRunDetailRow;
  canAdmin: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  APPROVED: "Aprobado",
  CANCELLED: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
};

function fmt(amount: string) {
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(Number(amount));
}

export function PayrollRunDetail({ companyId, run, canAdmin }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Agrupar líneas por empleado
  const byEmployee = run.lines.reduce<Record<string, typeof run.lines>>((acc, line) => {
    if (!acc[line.employeeId]) acc[line.employeeId] = [];
    acc[line.employeeId].push(line);
    return acc;
  }, {});

  function handleApprove() {
    if (!window.confirm(
      "¿Aprobar este proceso? Se generará el asiento contable de causación de nómina y no podrá revertirse directamente."
    )) return;

    setError(null);
    startTransition(async () => {
      const result = await approvePayrollRunAction(companyId, { runId: run.id });
      if (result.success) {
        toast.success("Nómina aprobada y asiento contable generado");
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Nómina {run.periodStart} — {run.periodEnd}
            </h2>
            <p className="text-sm text-gray-500 mt-1">{run.employeeCount} empleados</p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
        </div>

        {/* Totales */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Total Asignaciones</p>
            <p className="mt-1 text-2xl font-bold text-green-900 font-mono">{fmt(run.totalEarnings)}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-xs font-medium text-red-700 uppercase tracking-wide">Total Deducciones</p>
            <p className="mt-1 text-2xl font-bold text-red-900 font-mono">{fmt(run.totalDeductions)}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Neto a Pagar</p>
            <p className="mt-1 text-2xl font-bold text-blue-900 font-mono">{fmt(run.totalNet)}</p>
          </div>
        </div>

        {/* Acciones */}
        {canAdmin && run.status === "DRAFT" && (
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? "Aprobando…" : "Aprobar Nómina"}
            </button>
          </div>
        )}

        {run.status === "APPROVED" && run.transactionId && (
          <p className="mt-4 text-sm text-gray-500">
            Asiento contable generado: <span className="font-mono text-gray-700">{run.transactionId}</span>
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Líneas por empleado */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-medium text-gray-900">Detalle por Empleado</h3>
        </div>
        <div className="divide-y">
          {Object.entries(byEmployee).map(([empId, lines]) => {
            const name = lines[0]?.employeeName ?? empId;
            const earnings = lines
              .filter((l) => l.conceptType === "EARNING")
              .reduce((s, l) => s + Number(l.amount), 0);
            const deductions = lines
              .filter((l) => l.conceptType === "DEDUCTION")
              .reduce((s, l) => s + Number(l.amount), 0);
            const net = earnings - deductions;

            return (
              <div key={empId} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-gray-900">{name}</p>
                  <div className="flex gap-6 text-sm">
                    <span className="text-green-700">+{fmt(String(earnings))}</span>
                    <span className="text-red-600">-{fmt(String(deductions))}</span>
                    <span className="font-semibold text-gray-900">={fmt(String(net))}</span>
                  </div>
                </div>
                <table className="w-full text-xs text-gray-600">
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id}>
                        <td className="py-0.5 pr-4">{l.conceptCode}</td>
                        <td className={`py-0.5 text-right font-mono ${l.conceptType === "DEDUCTION" ? "text-red-600" : "text-green-700"}`}>
                          {l.conceptType === "DEDUCTION" ? "-" : "+"}{fmt(l.amount)}
                        </td>
                        {l.hours && (
                          <td className="py-0.5 pl-4 text-gray-400">{l.hours} h</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
