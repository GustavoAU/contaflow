"use client";
// src/modules/payroll/components/BcvRateList.tsx
// Fase NOM-D: Tabla de tasas BCV registradas

import type { BcvRateRow } from "../services/BenefitAccrualService";

const MONTHS = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

interface Props {
  rates: BcvRateRow[];
}

export default function BcvRateList({ rates }: Props) {
  if (rates.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">
        No hay tasas BCV registradas para esta empresa.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Año</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Mes</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Tasa anual (%)</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Tipo</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Fuente</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rates.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono">{r.year}</td>
              <td className="px-4 py-3">{MONTHS[r.month]}</td>
              <td className="px-4 py-3 text-right font-mono">
                {Number(r.annualRate).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.rateType === "ACTIVA"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-600"
                }`}>
                  {r.rateType === "ACTIVA" ? "Activa" : "Promedio"}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-500 uppercase text-xs">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
