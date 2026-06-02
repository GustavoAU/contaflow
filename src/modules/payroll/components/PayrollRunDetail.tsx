"use client";

// src/modules/payroll/components/PayrollRunDetail.tsx
// Fase NOM-C: detalle de un proceso de nómina con líneas por empleado

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { PayrollRunDetailRow } from "../services/PayrollRunService";
import { approvePayrollRunAction, cancelPayrollRunAction, exportPayrollBankTxtAction } from "../actions/payroll-run.actions";
import { formatAmount } from "@/lib/format";

interface Props {
  companyId: string;
  run: PayrollRunDetailRow;
  canAdmin: boolean;
  currency: string;
  // IV: salario mínimo vigente al período — para verificar topes de cotización
  salaryMinCap?: string | null;
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
  INCES_OBR:  "INCES Trabajador (0.5%)",
  RPE_OBR:    "Paro Forzoso RPE (0.5%)",
  HE_DIA:     "Horas Extra Diurnas",
  HE_NOC:     "Horas Extra Nocturnas",
  CESTA:      "Cesta Ticket",
  BONO_RESP:  "Bono de Responsabilidad",
  UTILIDADES: "Utilidades",
  VACACIONES: "Vacaciones",
  // C-04: aportes patronales
  IVSS_PAT:   "IVSS Patronal (9%)",
  INCES_PAT:  "INCES Patronal (2%)",
  FAOV_PAT:   "Banavih FAOV Patronal (2%)",
  RPE_PAT:    "Paro Forzoso Patronal (2%)",
};

function conceptLabel(code: string): string {
  return CONCEPT_LABELS[code] ?? code;
}

export function PayrollRunDetail({ companyId, run, canAdmin, currency, salaryMinCap }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRecalculating, startRecalculate] = useTransition();
  const [isExportingTxt, startExportTxt] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  // U-03: checklist obligatorio antes de aprobar
  const [salMinChecked, setSalMinChecked] = useState(false);

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

  function handleExportBankTxt() {
    startExportTxt(async () => {
      const res = await exportPayrollBankTxtAction(companyId, run.id);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const { txt, warningCount } = res.data;
      if (warningCount > 0) {
        toast.warning(
          `${warningCount} empleado(s) sin datos bancarios — revisa la sección Empleados antes de enviar al banco.`,
        );
      }
      const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pago-Masivo-${run.periodStart}-${run.periodEnd}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function handleRecalculate() {
    setError(null);
    startRecalculate(async () => {
      const result = await cancelPayrollRunAction(companyId, { runId: run.id });
      if (result.success) {
        toast.success("Nómina cancelada — puedes crear una nueva con las mismas fechas");
        router.push(
          `/company/${companyId}/payroll/runs/new?start=${run.periodStart}&end=${run.periodEnd}`
        );
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
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
              {run.bcvRateAtRun && (
                <span
                  className="ml-3 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600"
                  title="Tasa BCV anual aplicada para el cálculo de intereses sobre prestaciones en este período (C-05)"
                >
                  Tasa BCV prestaciones: {Number(run.bcvRateAtRun).toFixed(2)}%
                </span>
              )}
              {salaryMinCap && (
                <span
                  className="ml-3 inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600"
                  title="Salario mínimo vigente al período — tope base cotización IVSS/INCES/RPE (5×) y FAOV (10×)"
                >
                  Sal. mín.: Bs. {Number(salaryMinCap).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </span>
              )}
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
            {run.status === "APPROVED" && (
              <button
                onClick={handleExportBankTxt}
                disabled={isExportingTxt}
                title="Descarga archivo TXT compatible con portales de pago masivo de bancos venezolanos (pipe-delimited)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md bg-white hover:bg-zinc-50 text-zinc-700 disabled:opacity-50"
              >
                {isExportingTxt ? (
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                TXT Banco
              </button>
            )}
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[run.status] ?? ""}`}>
              {STATUS_LABELS[run.status] ?? run.status}
            </span>
          </div>
        </div>

        {/* Totales — C-04: 4 tarjetas cuando hay costo patronal */}
        <div className={`mt-6 grid gap-4 ${Number(run.totalEmployerCosts) > 0 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"}`}>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-xs font-medium text-green-700 uppercase tracking-wide">Total Asignaciones</p>
            <p className="mt-1 text-2xl font-bold text-green-900 font-mono">
              <span className="mr-1 text-sm font-semibold opacity-70">{currency}</span>
              {formatAmount(Number(run.totalEarnings))}
            </p>
          </div>
          <div className="bg-red-50 rounded-lg p-4">
            <p className="text-xs font-medium text-red-700 uppercase tracking-wide">Total Deducciones</p>
            <p className="mt-1 text-2xl font-bold text-red-900 font-mono">
              <span className="mr-1 text-sm font-semibold opacity-70">{currency}</span>
              {formatAmount(Number(run.totalDeductions))}
            </p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Neto a Pagar</p>
            <p className="mt-1 text-2xl font-bold text-blue-900 font-mono">
              <span className="mr-1 text-sm font-semibold opacity-70">{currency}</span>
              {formatAmount(Number(run.totalNet))}
            </p>
          </div>
          {Number(run.totalEmployerCosts) > 0 && (
            <div className="bg-orange-50 rounded-lg p-4">
              <p className="text-xs font-medium text-orange-700 uppercase tracking-wide">Costo Patronal</p>
              <p className="mt-1 text-2xl font-bold text-orange-900 font-mono">
                <span className="mr-1 text-sm font-semibold opacity-70">{currency}</span>
                {formatAmount(Number(run.totalEmployerCosts))}
              </p>
              <p className="mt-0.5 text-xs text-orange-600">IVSS/INCES/FAOV/RPE patronal</p>
            </div>
          )}
        </div>

        {/* Acciones */}
        {canAdmin && run.status === "DRAFT" && (
          <div className="mt-6 flex flex-wrap gap-3 items-center">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={isPending || isRecalculating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {isPending && <Loader2Icon className="size-4 animate-spin" />}
              {isPending ? "Aprobando…" : "Aprobar Nómina"}
            </button>
            <button
              onClick={handleRecalculate}
              disabled={isPending || isRecalculating}
              title="Cancela este borrador y abre el formulario con las mismas fechas para recalcular"
              className="inline-flex items-center gap-2 px-4 py-2 border border-orange-300 text-orange-700 rounded-md text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
            >
              {isRecalculating && <Loader2Icon className="size-4 animate-spin" />}
              {isRecalculating ? "Cancelando…" : "Recalcular"}
            </button>
            <p className="text-xs text-gray-400">
              Aprobar generará el asiento contable y no podrá revertirse directamente.
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

        {/* IV: alerta cuando no hay aportes patronales — posible config incompleta */}
        {run.employeeCount > 0 && Number(run.totalEmployerCosts) === 0 && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            <strong>Sin aportes patronales registrados.</strong>{" "}
            Si la empresa está obligada a cotizar IVSS/INCES/FAOV/RPE, verifica que los conceptos patronales
            estén activos en <em>Configuración → Conceptos de Nómina</em>.
          </div>
        )}
      </div>

      {/* U-03: Modal de confirmación con checklist pre-aprobación */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">Confirmar aprobación de nómina</h3>
            <p className="mt-1 text-sm text-gray-500">
              Esta acción generará el asiento contable y no podrá revertirse directamente.
            </p>

            {/* Checklist de prerrequisitos — U-03 */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Verificación previa</p>

              {/* Tasa BCV prestaciones */}
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${run.bcvRateAtRun ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
                <span className="shrink-0 mt-0.5">{run.bcvRateAtRun ? "✓" : "⚠"}</span>
                <span>
                  <strong>Tasa BCV prestaciones:</strong>{" "}
                  {run.bcvRateAtRun
                    ? `Registrada — ${Number(run.bcvRateAtRun).toFixed(2)}% anual`
                    : "No registrada para este período. Regístrate en Nómina → Topes Legales → Tasa BCV antes de aprobar."}
                </span>
              </div>

              {/* Aportes patronales */}
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${Number(run.totalEmployerCosts) > 0 ? "bg-green-50 text-green-800" : "bg-gray-50 text-gray-600"}`}>
                <span className="shrink-0 mt-0.5">{Number(run.totalEmployerCosts) > 0 ? "✓" : "·"}</span>
                <span>
                  <strong>Aportes patronales (IVSS/INCES/FAOV/RPE):</strong>{" "}
                  {Number(run.totalEmployerCosts) > 0
                    ? `Calculados — ${currency} ${formatAmount(Number(run.totalEmployerCosts))}`
                    : "No hay aportes patronales en este proceso. Verifica la configuración si se esperan."}
                </span>
              </div>

              {/* Checkbox obligatorio — salario mínimo (manual, no derivable del run) */}
              <label className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-700 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={salMinChecked}
                  onChange={(e) => setSalMinChecked(e.target.checked)}
                  className="mt-0.5 accent-green-600"
                />
                <span>
                  <strong>Confirmo</strong> que el salario mínimo vigente en{" "}
                  <em>Nómina → Topes Legales</em> está actualizado al decreto presidencial vigente
                  y que las prestaciones del trimestre han sido acumuladas.
                </span>
              </label>
            </div>

            {/* Resumen de impacto contable */}
            <div className="mt-4 rounded-md border bg-gray-50 divide-y text-sm">
              <div className="flex justify-between px-4 py-2">
                <span className="text-gray-600">Empleados</span>
                <span className="font-medium">{run.employeeCount}</span>
              </div>
              <div className="flex justify-between px-4 py-2">
                <span className="text-gray-600">Total asignaciones</span>
                <span className="font-medium font-mono">{currency} {formatAmount(Number(run.totalEarnings))}</span>
              </div>
              <div className="flex justify-between px-4 py-2">
                <span className="text-gray-600">Total deducciones</span>
                <span className="font-medium font-mono text-red-700">{currency} {formatAmount(Number(run.totalDeductions))}</span>
              </div>
              <div className="flex justify-between px-4 py-2 bg-blue-50">
                <span className="font-medium text-blue-800">Neto a pagar</span>
                <span className="font-bold font-mono text-blue-900">{currency} {formatAmount(Number(run.totalNet))}</span>
              </div>
              {Number(run.totalEmployerCosts) > 0 && (
                <div className="flex justify-between px-4 py-2 bg-orange-50">
                  <span className="text-orange-700 text-xs">Aportes patronales (IVSS/INCES/FAOV/RPE)</span>
                  <span className="font-medium font-mono text-orange-900 text-xs">{currency} {formatAmount(Number(run.totalEmployerCosts))}</span>
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => { setShowConfirm(false); setSalMinChecked(false); }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleApprove}
                disabled={isPending || !salMinChecked}
                aria-busy={isPending}
                title={!salMinChecked ? "Debes confirmar la verificación del salario mínimo" : undefined}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending && <Loader2Icon className="size-4 animate-spin" />}
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
            const employerCosts = lines.filter((l) => l.conceptType === "EMPLOYER_COST");
            const totalEarnings = earnings.reduce((s, l) => s + Number(l.amount), 0);
            const totalDeductions = deductions.reduce((s, l) => s + Number(l.amount), 0);
            const totalPatronal = employerCosts.reduce((s, l) => s + Number(l.amount), 0);
            const net = totalEarnings - totalDeductions;

            return (
              <div key={empId} className="px-6 py-4">
                {/* Cabecera empleado */}
                <div className="flex items-center justify-between mb-3">
                  <p className="font-medium text-gray-900">{name}</p>
                  <div className="flex gap-6 text-sm">
                    <span className="text-green-700">
                      <span className="mr-0.5 text-xs opacity-60">{currency}</span>+{formatAmount(totalEarnings)}
                    </span>
                    <span className="text-red-600">
                      <span className="mr-0.5 text-xs opacity-60">{currency}</span>-{formatAmount(totalDeductions)}
                    </span>
                    <span className="font-semibold text-gray-900">
                      <span className="mr-0.5 text-xs font-normal opacity-60">{currency}</span>={formatAmount(net)}
                    </span>
                    {totalPatronal > 0 && (
                      <span className="text-orange-600 text-xs">
                        <span className="mr-0.5 opacity-60">{currency}</span>
                        {formatAmount(totalPatronal)} pat.
                      </span>
                    )}
                  </div>
                </div>

                {/* Asignaciones primero */}
                {earnings.length > 0 && (
                  <table className="w-full text-xs mb-1">
                    <tbody>
                      {earnings.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 pr-4 text-gray-600">
                            {conceptLabel(l.conceptCode)}
                            {/* U-02: base imponible visible */}
                            {l.basis && l.rate && (
                              <span className="ml-1.5 text-gray-400 font-normal">
                                ({(Number(l.rate) * 100).toFixed(2)}% s/ {formatAmount(Number(l.basis))})
                              </span>
                            )}
                          </td>
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

                {/* Deducciones del trabajador */}
                {deductions.length > 0 && (
                  <table className="w-full text-xs">
                    <tbody>
                      {deductions.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 pr-4 text-gray-500">
                            {conceptLabel(l.conceptCode)}
                            {/* U-02: base imponible visible */}
                            {l.basis && l.rate && (
                              <span className="ml-1.5 text-gray-400 font-normal">
                                ({(Number(l.rate) * 100).toFixed(2)}% s/ {formatAmount(Number(l.basis))})
                              </span>
                            )}
                          </td>
                          <td className="py-0.5 text-right font-mono text-red-600">
                            -{formatAmount(Number(l.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* C-04: Aportes patronales — costo del empleador, no del trabajador */}
                {employerCosts.length > 0 && (
                  <>
                    <div className="border-t border-dashed border-orange-200 my-1.5" />
                    <table className="w-full text-xs">
                      <tbody>
                        {employerCosts.map((l) => (
                          <tr key={l.id} className="opacity-80">
                            <td className="py-0.5 pr-4 text-orange-700">
                              {conceptLabel(l.conceptCode)}
                              {/* U-02: base imponible visible en aportes patronales */}
                              {l.basis && l.rate && (
                                <span className="ml-1.5 text-orange-400 font-normal">
                                  ({(Number(l.rate) * 100).toFixed(2)}% s/ {formatAmount(Number(l.basis))})
                                </span>
                              )}
                            </td>
                            <td className="py-0.5 text-right font-mono text-orange-700">
                              {formatAmount(Number(l.amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
