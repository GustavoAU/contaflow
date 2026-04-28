"use client";

// src/modules/payroll/components/PayrollRunDetail.tsx
// Fase NOM-C: detalle de un proceso de nómina con líneas por empleado

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { PayrollRunDetailRow } from "../services/PayrollRunService";
import { approvePayrollRunAction } from "../actions/payroll-run.actions";
import { formatAmount } from "@/lib/format";

interface Props {
  companyId: string;
  run: PayrollRunDetailRow;
  canAdmin: boolean;
  currency: string;
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

// Nombres amigables para conceptos del sistema
const CONCEPT_LABELS: Record<string, string> = {
  SAL_BASE:    "Salario Básico",
  IVSS_OBR:   "Seg. Social IVSS (4%)",
  FAOV_OBR:   "Banavih FAOV (1%)",
  INCES_OBR:  "INCES (2%)",
  RPE_OBR:    "Paro Forzoso RPE (0.5%)",
  HE_DIA:     "Horas Extra Diurnas",
  HE_NOC:     "Horas Extra Nocturnas",
  CESTA:      "Cesta Ticket",
  BONO_RESP:  "Bono de Responsabilidad",
  UTILIDADES: "Utilidades",
  VACACIONES: "Vacaciones",
};

function conceptLabel(code: string): string {
  return CONCEPT_LABELS[code] ?? code;
}

export function PayrollRunDetail({ companyId, run, canAdmin, currency }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Agrupar líneas por empleado
  const byEmployee = run.lines.reduce<Record<string, typeof run.lines>>((acc, line) => {
    if (!acc[line.employeeId]) acc[line.employeeId] = [];
    acc[line.employeeId].push(line);
    return acc;
  }, {});

  async function handleExportExcel() {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Nómina");

    ws.addRow(["NÓMINA"]);
    ws.addRow([`Período: ${run.periodStart} — ${run.periodEnd}`]);
    ws.addRow([`Moneda: ${currency}`]);
    ws.addRow([]);
    ws.addRow(["Empleado", "Concepto", "Tipo", "Monto", "Moneda"]);

    for (const [, lines] of Object.entries(byEmployee)) {
      for (const line of lines) {
        ws.addRow([
          line.employeeName,
          conceptLabel(line.conceptCode),
          line.conceptType === "EARNING" ? "Asignación" : "Deducción",
          parseFloat(line.amount),
          currency,
        ]);
      }
    }

    ws.addRow([]);
    ws.addRow(["", "", "Total Asignaciones", parseFloat(run.totalEarnings), currency]);
    ws.addRow(["", "", "Total Deducciones", parseFloat(run.totalDeductions), currency]);
    ws.addRow(["", "", "Neto a Pagar", parseFloat(run.totalNet), currency]);

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Nómina ${run.periodStart} - ${run.periodEnd}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleApprove() {
    setError(null);
    setShowConfirm(false);
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
            <p className="text-sm text-gray-500 mt-1">
              {run.employeeCount} empleados · {currency}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md bg-white hover:bg-zinc-50 text-zinc-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Exportar Excel
            </button>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
              {STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
        </div>

        {/* Totales */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Total Asignaciones</p>
            <p className="mt-1 text-2xl font-bold text-green-900 font-mono">
              {formatAmount(Number(run.totalEarnings))}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-xs font-medium text-red-700 uppercase tracking-wide">Total Deducciones</p>
            <p className="mt-1 text-2xl font-bold text-red-900 font-mono">
              {formatAmount(Number(run.totalDeductions))}
            </p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Neto a Pagar</p>
            <p className="mt-1 text-2xl font-bold text-blue-900 font-mono">
              {formatAmount(Number(run.totalNet))}
            </p>
          </div>
        </div>

        {/* Acciones */}
        {canAdmin && run.status === "DRAFT" && (
          <div className="mt-6 flex gap-3 items-center">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {isPending ? "Aprobando…" : "Aprobar Nómina"}
            </button>
            <p className="text-xs text-gray-400">
              Esta acción generará el asiento contable y no podrá revertirse directamente.
            </p>
          </div>
        )}

        {run.status === "APPROVED" && run.transactionId && (
          <p className="mt-4 text-sm text-gray-500">
            Asiento contable: <span className="font-mono text-gray-700">{run.transactionId}</span>
          </p>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Modal de confirmación */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">¿Aprobar nómina?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Se generarán los registros de pago para{" "}
              <strong>{run.employeeCount} empleados</strong> por un total de{" "}
              <strong>{currency} {formatAmount(Number(run.totalNet))}</strong> neto a pagar.
              Esta acción no puede revertirse directamente.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleApprove}
                disabled={isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? "Aprobando…" : "Confirmar aprobación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Líneas por empleado */}
      <div className="bg-white rounded-lg border">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-medium text-gray-900">Detalle por Empleado</h3>
        </div>
        <div className="divide-y">
          {Object.entries(byEmployee).map(([empId, lines]) => {
            const name = lines[0]?.employeeName ?? empId;
            const earnings = lines.filter((l) => l.conceptType === "EARNING");
            const deductions = lines.filter((l) => l.conceptType === "DEDUCTION");
            const totalEarnings = earnings.reduce((s, l) => s + Number(l.amount), 0);
            const totalDeductions = deductions.reduce((s, l) => s + Number(l.amount), 0);
            const net = totalEarnings - totalDeductions;

            return (
              <div key={empId} className="px-6 py-4">
                {/* Cabecera empleado */}
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-gray-900">{name}</p>
                  <div className="flex gap-6 text-sm">
                    <span className="text-green-700">+{formatAmount(totalEarnings)}</span>
                    <span className="text-red-600">-{formatAmount(totalDeductions)}</span>
                    <span className="font-semibold text-gray-900">={formatAmount(net)}</span>
                  </div>
                </div>

                {/* Asignaciones primero */}
                {earnings.length > 0 && (
                  <table className="w-full text-xs mb-1">
                    <tbody>
                      {earnings.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 pr-4 text-gray-600">{conceptLabel(l.conceptCode)}</td>
                          <td className="py-0.5 text-right font-mono text-green-700">
                            +{formatAmount(Number(l.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Separador visual si hay ambos */}
                {earnings.length > 0 && deductions.length > 0 && (
                  <div className="border-t border-dashed border-gray-200 my-1.5" />
                )}

                {/* Deducciones al final */}
                {deductions.length > 0 && (
                  <table className="w-full text-xs">
                    <tbody>
                      {deductions.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 pr-4 text-gray-500">{conceptLabel(l.conceptCode)}</td>
                          <td className="py-0.5 text-right font-mono text-red-600">
                            -{formatAmount(Number(l.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
