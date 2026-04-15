"use client";

// src/modules/payroll/components/PayrollRunList.tsx
// Fase NOM-C: lista de procesos de nómina con estado y totales

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { PayrollRunRow } from "../services/PayrollRunService";
import { cancelPayrollRunAction } from "../actions/payroll-run.actions";
import { randomUUID } from "crypto";

interface Props {
  companyId: string;
  runs: PayrollRunRow[];
  canAdmin: boolean;
  onApprove: (runId: string) => void;
  onViewDetail: (runId: string) => void;
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

function formatAmount(amount: string) {
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(Number(amount));
}

export function PayrollRunList({ companyId, runs, canAdmin, onApprove, onViewDetail }: Props) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCancel(runId: string) {
    if (!window.confirm("¿Estás seguro de cancelar este proceso de nómina?")) return;
    setCancellingId(runId);
    startTransition(async () => {
      const result = await cancelPayrollRunAction(companyId, {
        runId,
        reason: "Cancelado manualmente por el administrador",
      });
      if (result.success) {
        toast.success("Proceso cancelado");
      } else {
        toast.error(result.error);
      }
      setCancellingId(null);
    });
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium">No hay procesos de nómina</p>
        <p className="text-sm mt-1">Crea el primer proceso con el botón "Nuevo Proceso"</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Período</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Empleados</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Asignaciones</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Deducciones</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Neto a Pagar</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {runs.map((run) => (
            <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                {run.periodStart} — {run.periodEnd}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
                  {STATUS_LABELS[run.status] ?? run.status}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-700 text-right">{run.employeeCount}</td>
              <td className="px-4 py-3 text-sm text-gray-700 text-right font-mono">{formatAmount(run.totalEarnings)}</td>
              <td className="px-4 py-3 text-sm text-red-600 text-right font-mono">{formatAmount(run.totalDeductions)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right font-mono">{formatAmount(run.totalNet)}</td>
              <td className="px-4 py-3 text-sm space-x-2 whitespace-nowrap">
                <button
                  onClick={() => onViewDetail(run.id)}
                  className="text-blue-600 hover:underline text-xs"
                >
                  Ver detalle
                </button>
                {canAdmin && run.status === "DRAFT" && (
                  <>
                    <button
                      onClick={() => onApprove(run.id)}
                      className="text-green-600 hover:underline text-xs"
                    >
                      Aprobar
                    </button>
                    <button
                      onClick={() => handleCancel(run.id)}
                      disabled={isPending && cancellingId === run.id}
                      className="text-red-600 hover:underline text-xs disabled:opacity-50"
                    >
                      {isPending && cancellingId === run.id ? "Cancelando…" : "Cancelar"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
