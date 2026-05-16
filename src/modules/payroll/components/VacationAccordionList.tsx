"use client";
// Accordion controlado — monta VacationPanel solo cuando está abierto
// para garantizar estado limpio por empleado (evita filtración de showForm).

import { useState } from "react";
import VacationPanel from "./VacationPanel";
import type { VacationRecordRow } from "../services/VacationService";

interface EmployeeItem {
  id: string;
  fullName: string;
  position: string | null;
  yearsOfService: number;
  vacationEntitlement: number;
  vacationUsedThisYear: number;
}

interface Props {
  employees: EmployeeItem[];
  recordsByEmployee: Record<string, VacationRecordRow[]>;
  companyId: string;
  canAdmin: boolean;
}

export default function VacationAccordionList({
  employees,
  recordsByEmployee,
  companyId,
  canAdmin,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {employees.map((emp) => {
        const records = recordsByEmployee[emp.id] ?? [];
        const isOpen = openId === emp.id;
        return (
          <div key={emp.id} className="rounded-lg border overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between cursor-pointer px-4 py-3 hover:bg-gray-50 select-none"
              onClick={() => setOpenId(isOpen ? null : emp.id)}
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900">{emp.fullName}</span>
                <span className="text-xs text-gray-400">{emp.position}</span>
              </div>
              <div className="flex items-center gap-3">
                {/* VAC-2: balance derecho vs usados */}
                {(() => {
                  const remaining = emp.vacationEntitlement - emp.vacationUsedThisYear;
                  const colorClass = remaining <= 0
                    ? "bg-red-50 text-red-700"
                    : remaining <= 5
                    ? "bg-amber-50 text-amber-700"
                    : "bg-green-50 text-green-700";
                  return (
                    <span
                      className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}
                      title={`${emp.yearsOfService} año(s) de servicio — Derecho: ${emp.vacationEntitlement} días`}
                    >
                      {emp.vacationUsedThisYear}/{emp.vacationEntitlement} días
                    </span>
                  );
                })()}
                <span className="text-xs text-gray-500">
                  {records.length} registro{records.length !== 1 ? "s" : ""}
                </span>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isOpen && (
              <div className="px-4 py-4 border-t bg-white">
                <VacationPanel
                  key={emp.id}
                  companyId={companyId}
                  employeeId={emp.id}
                  initialRecords={records}
                  canAdmin={canAdmin}
                  vacationEntitlement={emp.vacationEntitlement}
                  vacationUsedThisYear={emp.vacationUsedThisYear}
                  yearsOfService={emp.yearsOfService}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
