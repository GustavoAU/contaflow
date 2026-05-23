"use client";
// src/modules/payroll/components/BenefitBalancePanel.tsx
// Fase NOM-D: Panel de saldo de prestaciones por empleado
// Incluye: historial de líneas con días adicionales + anticipos (Art. 144 LOTTT)

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
}

export default function BenefitBalancePanel({
  balance,
  initialAdvances = [],
  canAdmin = false,
  companyId,
  employeeId,
}: Props) {
  const [advances, setAdvances] = useState<BenefitAdvanceRow[]>(initialAdvances);
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);

  const total = Number(balance.currentBalance) + Number(balance.interestBalance);
  const totalAdvances = advances.reduce((s, a) => s + Number(a.amount), 0);

  return (
    <div className="space-y-4">
      {/* Resumen de saldos */}
      <div className="grid grid-cols-3 gap-3">
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

      {/* Historial de líneas */}
      {balance.lines.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50">
              <tr>
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
                return (
                  <tr key={line.id} className="hover:bg-gray-50">
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
