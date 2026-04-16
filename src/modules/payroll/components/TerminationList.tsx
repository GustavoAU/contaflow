"use client";
// src/modules/payroll/components/TerminationList.tsx
// Fase NOM-D: Tabla de liquidaciones finales con estado y totales

import Link from "next/link";
import type { TerminationRow } from "../services/TerminationService";

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

const REASON_LABELS: Record<string, string> = {
  RESIGNATION: "Renuncia voluntaria",
  DISMISSAL_JUSTIFIED: "Despido justificado",
  DISMISSAL_UNJUSTIFIED: "Despido injustificado",
  CONTRACT_END: "Fin de contrato",
  MUTUAL_AGREEMENT: "Mutuo acuerdo",
};

function fmt(amount: string) {
  return Number(amount).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

interface Props {
  companyId: string;
  terminations: TerminationRow[];
  employeeNames: Record<string, string>;
}

export default function TerminationList({ companyId, terminations, employeeNames }: Props) {
  if (terminations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-gray-500">
        No hay liquidaciones registradas.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Empleado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Causa</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Fecha egreso</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Total neto</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {terminations.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">
                {employeeNames[t.employeeId] ?? t.employeeId}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {REASON_LABELS[t.reason] ?? t.reason}
              </td>
              <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                {t.terminationDate}
              </td>
              <td className="px-4 py-3">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[t.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {STATUS_LABELS[t.status] ?? t.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                {fmt(t.totalNetAmount)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/company/${companyId}/payroll/terminations/${t.id}`}
                  className="text-blue-600 hover:underline text-xs"
                >
                  Ver
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
