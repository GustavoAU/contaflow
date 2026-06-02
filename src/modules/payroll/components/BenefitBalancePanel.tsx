"use client";
// src/modules/payroll/components/BenefitBalancePanel.tsx
// Fase NOM-D: Panel de saldo de prestaciones por empleado
// Incluye: historial de líneas con días adicionales + anticipos (Art. 144 LOTTT)
// F-05 (auditoria 2026-06-02): desglose salario integral por trimestre
// Saldo inicial previo al sistema para empleados con prestaciones antes de ContaFlow

import { useState } from "react";
import type { BenefitBalanceRow } from "../services/BenefitAccrualService";
import type { BenefitAdvanceRow } from "../services/BenefitAdvanceService";
import BenefitAdvanceForm from "./BenefitAdvanceForm";

const LINE_TYPE_LABELS: Record<string, string> = {
  QUARTERLY_ACCRUAL: "Acumulación trimestral",
  BCV_INTEREST: "Intereses BCV",
  ADJUSTMENT: "Ajuste",
};

const ADVANCE_REASON_LABELS: Record<string, string> = {
  HOUSING: "Vivienda",
  HEALTH: "Salud",
  EDUCATION: "Educación",
};

function fmt(amount: string | number) {
  return Number(amount).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  balance: BenefitBalanceRow;
  initialAdvances?: BenefitAdvanceRow[];
  canAdmin?: boolean;
  companyId?: string;
  employeeId?: string;
  // F-01: detectar brechas en historial salarial relativas a la antigüedad
  hireDate?: string;
  oldestSalaryDate?: string;
}

export default function BenefitBalancePanel({
  balance,
  initialAdvances = [],
  canAdmin = false,
  companyId,
  employeeId,
  hireDate,
  oldestSalaryDate,
}: Props) {
  const [advances, setAdvances] = useState<BenefitAdvanceRow[]>(initialAdvances);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());

  const hasInitial = Number(balance.initialBalance) > 0 || Number(balance.initialInterestBalance) > 0;
  const totalInitial = Number(balance.initialBalance) + Number(balance.initialInterestBalance);
  const total = Number(balance.currentBalance) + Number(balance.interestBalance) + totalInitial;
  const totalAdvances = advances.reduce((s, a) => s + Number(a.amount), 0);

  // F-01: brecha en historial salarial — el salario más antiguo no cubre toda la antigüedad
  const salaryHistoryGap = hireDate && (
    !oldestSalaryDate ||
    (new Date(oldestSalaryDate).getTime() - new Date(hireDate).getTime() > 90 * 24 * 60 * 60 * 1000)
  );

  function toggleExpand(id: string) {
    setExpandedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* F-01: advertencia brecha de historial salarial */}
      {salaryHistoryGap && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <p className="font-medium">Historial salarial incompleto — cálculos históricos pueden ser imprecisos</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {oldestSalaryDate
                ? `El registro salarial más antiguo es del ${new Date(oldestSalaryDate).toLocaleDateString("es-VE")}, pero el empleado ingresó el ${new Date(hireDate!).toLocaleDateString("es-VE")}.`
                : "No hay registros salariales para este empleado."}
              {" "}Los trimestres anteriores al primer registro usaron el salario disponible como proxy, lo que puede subestimar o sobrestimar las prestaciones históricas.
              Registre el historial completo de salarios en la pestaña <strong>Historial Salarial</strong> para garantizar la auditabilidad ante el MINPPTRASS.
            </p>
          </div>
        </div>
      )}

      {/* Resumen de saldos */}
      <div className={`grid gap-3 ${hasInitial ? "grid-cols-4" : "grid-cols-3"}`}>
        {hasInitial && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs text-amber-700 font-medium">Saldo previo al sistema</p>
            <p className="mt-1 text-lg font-mono font-semibold text-amber-900">
              {fmt(totalInitial.toString())}
            </p>
            <p className="mt-0.5 text-xs text-amber-600">
              Garantía: {fmt(balance.initialBalance)} + Int.: {fmt(balance.initialInterestBalance)}
            </p>
          </div>
        )}
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
          <p className="text-xs text-blue-600 font-medium">Garantía acumulada</p>
          <p className="mt-1 text-lg font-mono font-semibold text-blue-900">
            {fmt(balance.currentBalance)}
          </p>
        </div>
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
          <p className="text-xs text-purple-600 font-medium">Intereses acumulados</p>
          <p className="mt-1 text-lg font-mono font-semibold text-purple-900">
            {fmt(balance.interestBalance)}
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <p className="text-xs text-gray-600 font-medium">Total prestaciones</p>
          <p className="mt-1 text-lg font-mono font-semibold text-gray-900">
            {fmt(total.toString())}
          </p>
          {balance.isLiquidated && (
            <span className="mt-1 inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
              Liquidado
            </span>
          )}
        </div>
      </div>

      {/* Historial de líneas — F-05: desglose salario integral */}
      {balance.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="w-4 px-2 py-2" />
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Tipo</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Período</th>
                <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Días</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Monto</th>
                <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Saldo acum.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {balance.lines.map((line) => {
                const hasAdditional = line.type === "QUARTERLY_ACCRUAL" && line.additionalDays && Number(line.additionalDays) > 0;
                const isExpanded = expandedLines.has(line.id);
                const hasIntegral = line.type === "QUARTERLY_ACCRUAL" && line.integralDailyWage;

                return (
                  <>
                    <tr
                      key={line.id}
                      className={`hover:bg-gray-50 ${hasIntegral ? "cursor-pointer" : ""}`}
                      onClick={() => hasIntegral && toggleExpand(line.id)}
                    >
                      <td className="px-2 py-2 text-center text-gray-400">
                        {hasIntegral && (
                          <svg
                            className={`inline h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {LINE_TYPE_LABELS[line.type] ?? line.type}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {line.quarter
                          ? `Q${line.quarter}-${line.year}`
                          : `${line.year}-${String(line.month).padStart(2, "0")}`}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {line.type === "QUARTERLY_ACCRUAL" ? (
                          <span title={hasAdditional ? `${line.accrualDays ?? 5} base + ${Number(line.additionalDays).toFixed(2)} antigüedad` : undefined}>
                            {line.accrualDays ?? 5}
                            {hasAdditional && (
                              <span className="ml-1 text-amber-600 font-semibold">
                                +{Number(line.additionalDays).toFixed(2)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${Number(line.accrualAmount) >= 0 ? "text-green-700" : "text-red-600"}`}>
                        {fmt(line.accrualAmount)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">
                        {fmt(line.runningBalance)}
                      </td>
                    </tr>

                    {/* F-05: desglose salario integral — visible al expandir trimestre */}
                    {isExpanded && hasIntegral && (
                      <tr key={`${line.id}-detail`} className="bg-blue-50">
                        <td />
                        <td colSpan={5} className="px-4 py-2">
                          <p className="text-xs font-medium text-blue-700 mb-1">
                            Desglose salario integral (Art. 104 LOTTT):
                          </p>
                          <div className="grid grid-cols-4 gap-3 text-xs">
                            <div>
                              <p className="text-gray-500">Salario diario normal</p>
                              <p className="font-mono font-semibold text-gray-800">
                                {line.dailyNormalWage ? fmt(line.dailyNormalWage) : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">+ Alíc. utilidades</p>
                              <p className="font-mono font-semibold text-gray-800">
                                {line.profitDaysAliquot ? fmt(line.profitDaysAliquot) : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-gray-500">+ Alíc. bono vacacional</p>
                              <p className="font-mono font-semibold text-gray-800">
                                {line.vacationBonusDaysAliquot ? fmt(line.vacationBonusDaysAliquot) : "—"}
                              </p>
                            </div>
                            <div className="rounded bg-blue-100 px-2 py-1">
                              <p className="text-blue-600 font-medium">= Salario integral/día</p>
                              <p className="font-mono font-bold text-blue-900">
                                {line.integralDailyWage ? fmt(line.integralDailyWage) : "—"}
                              </p>
                            </div>
                          </div>
                          {line.appliedRate && (
                            <p className="mt-1.5 text-xs text-purple-700">
                              Tasa BCV aplicada: <strong>{line.appliedRate}%</strong>
                            </p>
                          )}
                          {line.originalCurrency && (
                            <p className="mt-1.5 text-xs text-blue-700">
                              Salario original en <strong>{line.originalCurrency}</strong>
                              {line.exchangeRateAtAccrual
                                ? <> — tasa usada: <strong className="font-mono">Bs. {fmt(line.exchangeRateAtAccrual)}/{line.originalCurrency}</strong></>
                                : <span className="ml-1 text-amber-600"> — sin tasa registrada (monto puede ser incorrecto)</span>}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {balance.lines.length === 0 && (
        <p className="text-sm text-gray-400 italic">Sin movimientos registrados</p>
      )}

      {/* Anticipos registrados */}
      {(advances.length > 0 || canAdmin) && !balance.isLiquidated && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Anticipos (Art. 144 LOTTT)
            </p>
            {canAdmin && companyId && employeeId && !showAdvanceForm && (
              <button
                type="button"
                onClick={() => setShowAdvanceForm(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors border border-amber-200"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Registrar anticipo
              </button>
            )}
          </div>

          {showAdvanceForm && companyId && employeeId && (
            <BenefitAdvanceForm
              companyId={companyId}
              employeeId={employeeId}
              maxAmount={Number(balance.currentBalance)}
              onRegistered={(adv) => {
                setAdvances((prev) => [adv, ...prev]);
                setShowAdvanceForm(false);
              }}
              onCancel={() => setShowAdvanceForm(false)}
            />
          )}

          {advances.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-amber-50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Fecha</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Motivo</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Monto</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {advances.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500">
                        {new Date(a.createdAt).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-3 py-2">
                        {ADVANCE_REASON_LABELS[a.reason] ?? a.reason}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-600">
                        -{fmt(a.amount)}
                      </td>
                      <td className="px-3 py-2 text-gray-400">{a.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-xs text-gray-600 font-medium">Total anticipos</td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-red-600">
                      -{fmt(totalAdvances.toString())}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {canAdmin && advances.length === 0 && !showAdvanceForm && (
            <p className="text-xs text-gray-400 italic">Sin anticipos registrados</p>
          )}
        </div>
      )}

    </div>
  );
}
