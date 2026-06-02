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

// Art. 45 LOTTT: período de prueba máximo 6 meses
const PROBATION_MS = 6 * 30 * 24 * 60 * 60 * 1000;
function isProbation(hireDate: string | null): boolean {
  if (!hireDate) return false;
  return Date.now() - new Date(hireDate).getTime() < PROBATION_MS;
}
// Días restantes hasta que venza el período de prueba (null si no aplica)
function probationDaysLeft(hireDate: string | null): number | null {
  if (!hireDate) return null;
  const elapsed = Date.now() - new Date(hireDate).getTime();
  if (elapsed >= PROBATION_MS) return null;
  return Math.ceil((PROBATION_MS - elapsed) / (24 * 60 * 60 * 1000));
}

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
  const [filterContract, setFilterContract] = useState<string>("");
  const [filterCurrency, setFilterCurrency] = useState<string>("");

  const filtered = employees.filter((e) => {
    if (query.trim()) {
      const q = query.toLowerCase();
      const matchesSearch =
        e.fullName.toLowerCase().includes(q) ||
        e.cedula?.toLowerCase().includes(q) ||
        e.position?.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    if (filterContract && e.contractType !== filterContract) return false;
    if (filterCurrency && e.currentSalaryCurrency !== filterCurrency) return false;
    return true;
  });

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
      {/* U-06: barra de búsqueda + filtros rápidos */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, cédula o cargo…"
          className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Buscar empleados"
        />
        <select
          value={filterContract}
          onChange={(e) => setFilterContract(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filtrar por tipo de contrato"
        >
          <option value="">Todos los contratos</option>
          <option value="INDEFINIDO">Indefinido</option>
          <option value="DETERMINADO">Determinado</option>
          <option value="OBRA_DETERMINADA">Obra determ.</option>
        </select>
        <select
          value={filterCurrency}
          onChange={(e) => setFilterCurrency(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filtrar por moneda de salario"
        >
          <option value="">Todas las monedas</option>
          <option value="VES">VES</option>
          <option value="USD">USD</option>
        </select>
        {(query || filterContract || filterCurrency) && (
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
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{CONTRACT_LABELS[emp.contractType] ?? emp.contractType}</span>
                      {/* C-06: tipo trabajador LOTTT — relevante para Forma 14-02 IVSS */}
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                          emp.payrollWorkerType === "OBRERO"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-sky-100 text-sky-700"
                        }`}
                        title={emp.payrollWorkerType === "OBRERO" ? "Obrero (Forma 14-02 IVSS)" : "Empleado"}
                      >
                        {emp.payrollWorkerType === "OBRERO" ? "Obrero" : "Empleado"}
                      </span>
                      {/* Art. 45 LOTTT: badge de período de prueba con countdown */}
                      {emp.status === "ACTIVE" && isProbation(emp.hireDate) && (() => {
                        const daysLeft = probationDaysLeft(emp.hireDate);
                        const urgent = daysLeft !== null && daysLeft <= 30;
                        return (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                              urgent ? "bg-red-100 text-red-700" : "bg-purple-100 text-purple-700"
                            }`}
                            title={
                              daysLeft !== null
                                ? `Art. 45 LOTTT — ${daysLeft} días para vencer el período de prueba`
                                : "Art. 45 LOTTT — En período de prueba (menos de 6 meses)"
                            }
                          >
                            {urgent && daysLeft !== null ? `Prueba · ${daysLeft}d` : "Prueba"}
                          </span>
                        );
                      })()}
                    </div>
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
