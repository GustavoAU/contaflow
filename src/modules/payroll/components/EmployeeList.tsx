"use client";
// src/modules/payroll/components/EmployeeList.tsx
// U-01: chip de moneda por color (USD verde / VES azul)
// U-06: filtro/búsqueda por nombre o cédula (state local)

import { useState } from "react";
import Link from "next/link";
import type { EmployeeListRow } from "../services/EmployeeService";
import { formatAmount } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  TERMINATED: "Egresado",
};

const STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  INACTIVE: "bg-yellow-100 text-yellow-800",
  TERMINATED: "bg-gray-100 text-gray-500",
};

const CONTRACT_LABELS: Record<string, string> = {
  INDEFINIDO: "Indefinido",
  DETERMINADO: "Determinado",
  OBRA_DETERMINADA: "Obra determ.",
};

// U-01: chip de moneda con color diferenciado
const CURRENCY_CHIP: Record<string, string> = {
  USD: "bg-green-100 text-green-800",
  VES: "bg-blue-100 text-blue-800",
  MIXED: "bg-purple-100 text-purple-800",
};

interface Props {
  companyId: string;
  employees: EmployeeListRow[];
  canWrite: boolean;
}

export default function EmployeeList({ companyId, employees, canWrite }: Props) {
  // U-06: búsqueda local por nombre o cédula
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? employees.filter((e) => {
        const q = query.toLowerCase();
        return (
          e.fullName.toLowerCase().includes(q) ||
          e.cedula?.toLowerCase().includes(q) ||
          e.position?.toLowerCase().includes(q)
        );
      })
    : employees;

  if (employees.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-gray-500">
        No hay empleados registrados.{" "}
        {canWrite && (
          <Link
            href={`/company/${companyId}/payroll/employees/new`}
            className="text-blue-600 hover:underline"
          >
            Registrar primer empleado
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* U-06: barra de búsqueda */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, cédula o cargo…"
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Buscar empleados"
        />
        {query && (
          <span className="text-xs text-gray-500">
            {filtered.length} de {employees.length}
          </span>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">
          No hay empleados que coincidan con &ldquo;{query}&rdquo;.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Empleado</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Cédula</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Cargo</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Contrato</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Salario actual</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
                <th scope="col" className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{emp.fullName}</td>
                  <td className="px-4 py-3 text-gray-600">{emp.cedula}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{emp.position}</div>
                    {emp.department && (
                      <div className="text-xs text-gray-400">{emp.department}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {CONTRACT_LABELS[emp.contractType] ?? emp.contractType}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {emp.currentSalaryAmount ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatAmount(emp.currentSalaryAmount, emp.currentSalaryCurrency ?? undefined)}
                        {/* U-01: chip de moneda con color diferenciado */}
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
                            CURRENCY_CHIP[emp.currentSalaryCurrency ?? ""] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {emp.currentSalaryCurrency}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">Sin salario</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_CLASSES[emp.status] ?? "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {STATUS_LABELS[emp.status] ?? emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/company/${companyId}/payroll/employees/${emp.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
