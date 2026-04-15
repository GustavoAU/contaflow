"use client";
// src/modules/payroll/components/EmployeeList.tsx
// Fase NOM-B: tabla de empleados con estado y salario actual

import Link from "next/link";
import type { EmployeeListRow } from "../services/EmployeeService";

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

interface Props {
  companyId: string;
  employees: EmployeeListRow[];
  canWrite: boolean;
}

export default function EmployeeList({ companyId, employees, canWrite }: Props) {
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
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Empleado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Cédula</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Cargo</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Contrato</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Salario actual</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {employees.map((emp) => (
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
                  <span>
                    {Number(emp.currentSalaryAmount).toLocaleString("es-VE", {
                      minimumFractionDigits: 2,
                    })}{" "}
                    <span className="text-xs text-gray-400">{emp.currentSalaryCurrency}</span>
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
  );
}
