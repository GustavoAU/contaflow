"use client";
// src/modules/payroll/components/BenefitBalancePanel.tsx
// Fase NOM-D: Panel de saldo de prestaciones por empleado

import type { BenefitBalanceRow } from "../services/BenefitAccrualService";

const LINE_TYPE_LABELS: Record<string, string> = {
  ACCRUAL: "Acumulación trimestral",
  INTEREST: "Intereses BCV",
  LIQUIDATION: "Liquidación",
};

function fmt(amount: string) {
  return Number(amount).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

interface Props {
  balance: BenefitBalanceRow;
}

export default function BenefitBalancePanel({ balance }: Props) {
  const total = Number(balance.currentBalance) + Number(balance.interestBalance);

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
                <th className="px-3 py-2 text-left font-medium text-gray-600">Tipo</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Período</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Monto</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Saldo acum.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {balance.lines.map((line) => (
                <tr key={line.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    {LINE_TYPE_LABELS[line.type] ?? line.type}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {line.quarter ? `Q${line.quarter}-${line.year}` : `${line.year}-${String(line.month).padStart(2, "0")}`}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${Number(line.accrualAmount) >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {fmt(line.accrualAmount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">
                    {fmt(line.runningBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {balance.lines.length === 0 && (
        <p className="text-sm text-gray-400 italic">Sin movimientos registrados</p>
      )}
    </div>
  );
}
