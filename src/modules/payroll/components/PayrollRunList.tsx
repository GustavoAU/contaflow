"use client";

// src/modules/payroll/components/PayrollRunList.tsx
// Fase NOM-C: lista de procesos de nómina con estado y totales

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { PayrollRunRow } from "../services/PayrollRunService";
import {
  cancelPayrollRunAction,
  approvePayrollRunAction,
} from "../actions/payroll-run.actions";
import { formatAmount } from "@/lib/format";

interface Props {
  companyId: string;
  runs: PayrollRunRow[];
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

export function PayrollRunList({ companyId, runs, canAdmin }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApprove(runId: string) {
    setPendingId(runId);
    startTransition(async () => {
      const result = await approvePayrollRunAction(companyId, { runId });
      if (result.success) {
        toast.success("Proceso aprobado");
      } else {
        toast.error(result.error);
      }
      setPendingId(null);
    });
  }

  function handleCancel(runId: string) {
    if (!window.confirm("¿Estás seguro de cancelar este proceso de nómina?")) return;
    setPendingId(runId);
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
      setPendingId(null);
    });
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg font-medium">No hay procesos de nómina</p>
        <p className="text-sm mt-1">Crea el primer proceso con el botón &quot;Nuevo Proceso&quot;</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Período</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Empleados</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Asignaciones</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Deducciones</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Neto a Pagar</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
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
              <td className="px-4 py-3 text-sm text-gray-700 text-right font-mono">
                {formatAmount(Number(run.totalEarnings))}
              </td>
              <td className="px-4 py-3 text-sm text-red-600 text-right font-mono">
                {formatAmount(Number(run.totalDeductions))}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right font-mono">
                {formatAmount(Number(run.totalNet))}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/company/${companyId}/payroll/runs/${run.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    Ver
                  </Link>
                  {canAdmin && run.status === "DRAFT" && (
                    <>
                      <button
                        onClick={() => handleApprove(run.id)}
                        disabled={isPending && pendingId === run.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        {isPending && pendingId === run.id ? "Aprobando…" : "Aprobar"}
                      </button>
                      <button
                        onClick={() => handleCancel(run.id)}
                        disabled={isPending && pendingId === run.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        {isPending && pendingId === run.id ? "Cancelando…" : "Cancelar"}
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
