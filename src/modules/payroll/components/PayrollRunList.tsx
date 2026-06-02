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

// U-02: modal de confirmación antes de aprobar un proceso de nómina
interface ApproveDialogProps {
  run: PayrollRunRow;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}
function ApproveDialog({ run, onConfirm, onCancel, isPending }: ApproveDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Confirmar aprobación de nómina</h2>
        <p className="mt-1 text-sm text-gray-500">
          Una vez aprobado, el proceso quedará cerrado y se generará el asiento contable. Esta acción no se puede deshacer.
        </p>
        {/* Resumen del run */}
        <dl className="mt-4 divide-y divide-gray-100 rounded-lg border text-sm">
          <div className="flex justify-between px-4 py-2">
            <dt className="text-gray-500">Período</dt>
            <dd className="font-mono font-medium">{run.periodStart} — {run.periodEnd}</dd>
          </div>
          <div className="flex justify-between px-4 py-2">
            <dt className="text-gray-500">Empleados</dt>
            <dd className="font-medium">{run.employeeCount}</dd>
          </div>
          <div className="flex justify-between px-4 py-2">
            <dt className="text-gray-500">Total asignaciones</dt>
            <dd className="font-mono font-medium text-gray-900">{formatAmount(Number(run.totalEarnings))}</dd>
          </div>
          <div className="flex justify-between px-4 py-2">
            <dt className="text-gray-500">Total deducciones</dt>
            <dd className="font-mono font-medium text-red-600">{formatAmount(Number(run.totalDeductions))}</dd>
          </div>
          <div className="flex justify-between bg-gray-50 px-4 py-2">
            <dt className="font-semibold text-gray-900">Neto a pagar</dt>
            <dd className="font-mono font-semibold text-gray-900">{formatAmount(Number(run.totalNet))}</dd>
          </div>
          {Number(run.totalEmployerCosts) > 0 && (
            <div className="flex justify-between bg-orange-50 px-4 py-2">
              <dt className="text-orange-700 text-xs">Costo patronal (IVSS/INCES/FAOV/RPE)</dt>
              <dd className="font-mono font-medium text-orange-900 text-xs">{formatAmount(Number(run.totalEmployerCosts))}</dd>
            </div>
          )}
        </dl>
        {/* Alerta si deducciones anómalas */}
        {Number(run.totalEarnings) > 0 &&
          Number(run.totalDeductions) / Number(run.totalEarnings) < 0.02 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span>Las deducciones parafiscales son anómalas (&lt;2%). Verifica los topes de IVSS/INCES/FAOV antes de aprobar.</span>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? "Aprobando…" : "Confirmar aprobación"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PayrollRunList({ companyId, runs, canAdmin }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<PayrollRunRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // U-02: el botón Aprobar abre el modal — la confirmación ejecuta la acción
  function handleApproveClick(run: PayrollRunRow) {
    setConfirmRun(run);
  }

  function handleApproveConfirm() {
    if (!confirmRun) return;
    const runId = confirmRun.id;
    setConfirmRun(null);
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
    <>
      {/* U-02: modal de confirmación de aprobación */}
      {confirmRun && (
        <ApproveDialog
          run={confirmRun}
          onConfirm={handleApproveConfirm}
          onCancel={() => setConfirmRun(null)}
          isPending={isPending}
        />
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Período</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Empleados</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Asignaciones</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Deducciones</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Neto / Costo Patronal</th>
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
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
                      {STATUS_LABELS[run.status] ?? run.status}
                    </span>
                    {/* Alerta si deducciones < 2% de asignaciones — indica salario mínimo desactualizado */}
                    {Number(run.totalEarnings) > 0 &&
                      Number(run.totalDeductions) / Number(run.totalEarnings) < 0.02 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                        title="Las deducciones parafiscales representan menos del 2% de las asignaciones. Verifica los topes de IVSS/INCES/FAOV — puede indicar salario mínimo desactualizado."
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        Topes
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right">{run.employeeCount}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right font-mono">
                  {formatAmount(Number(run.totalEarnings))}
                </td>
                <td className="px-4 py-3 text-sm text-red-600 text-right font-mono">
                  {formatAmount(Number(run.totalDeductions))}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-gray-900 font-mono block">
                    {formatAmount(Number(run.totalNet))}
                  </span>
                  {Number(run.totalEmployerCosts) > 0 && (
                    <span className="text-xs text-orange-600 font-mono block">
                      +{formatAmount(Number(run.totalEmployerCosts))} pat.
                    </span>
                  )}
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
                          onClick={() => handleApproveClick(run)}
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
    </>
  );
}
