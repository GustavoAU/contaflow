"use client";
// src/modules/payroll/components/TerminationDetail.tsx
// Fase NOM-D: Vista de detalle + edición DRAFT + wizard finalización

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { TerminationRow } from "../services/TerminationService";
import { updateTerminationAction, finalizeTerminationAction } from "../actions/nom-d.actions";

const REASON_LABELS: Record<string, string> = {
  RESIGNATION: "Renuncia voluntaria",
  DISMISSAL_JUSTIFIED: "Despido justificado",
  DISMISSAL_UNJUSTIFIED: "Despido injustificado",
  CONTRACT_END: "Fin de contrato",
  MUTUAL_AGREEMENT: "Mutuo acuerdo",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  FINALIZING: "Procesando",
  FINALIZED: "Finalizada",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-800",
  FINALIZING: "bg-blue-100 text-blue-800",
  FINALIZED: "bg-green-100 text-green-800",
};

function fmt(amount: string) {
  return Number(amount).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

function fmtDays(days: string) {
  return Number(days).toFixed(2);
}

interface Props {
  companyId: string;
  termination: TerminationRow;
  employeeName: string;
  canAdmin: boolean;
}

export default function TerminationDetail({ companyId, termination: initial, employeeName, canAdmin }: Props) {
  const router = useRouter();
  const [t, setT] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [isFinalizing, startFinalizing] = useTransition();
  const [editing, setEditing] = useState(false);
  const [pendingConceptsAmount, setPendingConceptsAmount] = useState(t.pendingConceptsAmount);
  const [pendingConceptsNotes, setPendingConceptsNotes] = useState(t.pendingConceptsNotes ?? "");
  const [deductionsAmount, setDeductionsAmount] = useState(t.deductionsAmount);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateTerminationAction(companyId, t.id, {
        pendingConceptsAmount: parseFloat(pendingConceptsAmount),
        pendingConceptsNotes: pendingConceptsNotes || undefined,
        deductionsAmount: parseFloat(deductionsAmount),
      });
      if (result.success) {
        setT(result.data);
        setEditing(false);
        toast.success("Liquidación actualizada");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleFinalize() {
    if (!window.confirm(
      `¿Finalizar la liquidación de ${employeeName}?\n\nEsta acción es IRREVERSIBLE. Se creará el asiento contable y el empleado quedará marcado como EGRESADO.`
    )) return;
    startFinalizing(async () => {
      const result = await finalizeTerminationAction(companyId, t.id);
      if (result.success) {
        setT(result.data);
        toast.success("Liquidación finalizada y asiento contable registrado");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const isDraft = t.status === "DRAFT";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Liquidación Final</p>
          <h2 className="text-xl font-bold text-gray-900">{employeeName}</h2>
          <p className="text-sm text-gray-600">
            {REASON_LABELS[t.reason]} · {t.terminationDate}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[t.status]}`}>
          {STATUS_LABELS[t.status]}
        </span>
      </div>

      {/* Tabla de componentes */}
      <div className="rounded-lg border overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Concepto</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Días</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            <tr>
              <td className="px-4 py-3">Prestaciones acumuladas</td>
              <td className="px-4 py-3 text-right text-gray-400">—</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(t.benefitsAccumulatedAmount)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Intereses sobre prestaciones</td>
              <td className="px-4 py-3 text-right text-gray-400">—</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(t.benefitsInterestAmount)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3">
                Vacaciones fraccionadas
                {Number(t.vacationFractionalDays) > 0 && (
                  <span className="ml-1 text-xs text-gray-400">({fmtDays(t.vacationFractionalDays)} días)</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-500 text-xs">{fmtDays(t.vacationFractionalDays)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(t.vacationFractionalAmount)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Bono vacacional fraccionado</td>
              <td className="px-4 py-3 text-right text-gray-400">—</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(t.vacationBonusFractionalAmount)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3">
                Utilidades fraccionadas
                {Number(t.profitSharingFractionalDays) > 0 && (
                  <span className="ml-1 text-xs text-gray-400">({fmtDays(t.profitSharingFractionalDays)} días)</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono text-gray-500 text-xs">{fmtDays(t.profitSharingFractionalDays)}</td>
              <td className="px-4 py-3 text-right font-mono">{fmt(t.profitSharingFractionalAmount)}</td>
            </tr>
            {Number(t.indemnificationAmount) > 0 && (
              <tr className="bg-amber-50">
                <td className="px-4 py-3 font-medium text-amber-800">
                  Indemnización (Art. 92 LOTTT)
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-amber-800">
                  {fmt(t.indemnificationAmount)}
                </td>
              </tr>
            )}
            {Number(t.pendingConceptsAmount) > 0 && (
              <tr>
                <td className="px-4 py-3">
                  Conceptos pendientes
                  {t.pendingConceptsNotes && (
                    <span className="ml-1 text-xs text-gray-400">({t.pendingConceptsNotes})</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
                <td className="px-4 py-3 text-right font-mono">{fmt(t.pendingConceptsAmount)}</td>
              </tr>
            )}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-4 py-3">Total bruto</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right font-mono text-gray-900">{fmt(t.totalGrossAmount)}</td>
            </tr>
            {Number(t.deductionsAmount) > 0 && (
              <tr className="text-red-600">
                <td className="px-4 py-3">Deducciones</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right font-mono">− {fmt(t.deductionsAmount)}</td>
              </tr>
            )}
            <tr className="bg-blue-50 font-bold text-blue-900">
              <td className="px-4 py-3">Total neto a pagar</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right font-mono text-lg">{fmt(t.totalNetAmount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Edición de conceptos pendientes y deducciones (solo DRAFT + ADMIN) */}
      {isDraft && canAdmin && (
        <div className="rounded-lg border border-dashed p-4">
          {!editing ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Puedes ajustar conceptos pendientes y deducciones antes de finalizar.
              </p>
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                Editar ajustes
              </button>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Conceptos pendientes
                  </label>
                  <input
                    type="number"
                    value={pendingConceptsAmount}
                    onChange={(e) => setPendingConceptsAmount(e.target.value)}
                    min={0}
                    step={0.01}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Deducciones
                  </label>
                  <input
                    type="number"
                    value={deductionsAmount}
                    onChange={(e) => setDeductionsAmount(e.target.value)}
                    min={0}
                    step={0.01}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Notas (opcional)
                </label>
                <input
                  type="text"
                  value={pendingConceptsNotes}
                  onChange={(e) => setPendingConceptsNotes(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descripción de conceptos pendientes…"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isPending ? "Guardando…" : "Guardar cambios"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Finalizar */}
      {isDraft && canAdmin && !editing && (
        <div className="flex items-center gap-4 pt-2">
          <button
            onClick={handleFinalize}
            disabled={isFinalizing}
            className="rounded-md bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isFinalizing ? "Finalizando…" : "Finalizar liquidación"}
          </button>
          <p className="text-xs text-gray-500">
            Se creará el asiento contable. Acción irreversible.
          </p>
        </div>
      )}

      {/* Metadatos */}
      <div className="text-xs text-gray-400 space-y-1 pt-2 border-t">
        <p>ID: <span className="font-mono">{t.id}</span></p>
        <p>Clave idempotencia: <span className="font-mono">{t.idempotencyKey}</span></p>
        {t.finalizedAt && (
          <p>Finalizada el: {new Date(t.finalizedAt).toLocaleDateString("es-VE")}</p>
        )}
        {t.transactionId && (
          <p>Asiento contable: <span className="font-mono">{t.transactionId}</span></p>
        )}
      </div>
    </div>
  );
}
