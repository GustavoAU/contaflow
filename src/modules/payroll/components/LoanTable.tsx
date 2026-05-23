"use client";
// src/modules/payroll/components/LoanTable.tsx
// Tabla de préstamos con botón cancelar (ADMIN_ONLY).

import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { cancelLoanAction } from "../actions/employee-loan.actions";
import CreateLoanForm from "./CreateLoanForm";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";
import { formatAmount } from "@/lib/format";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Activo", className: "bg-blue-100 text-blue-800" },
  PAID: { label: "Pagado", className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "Cancelado", className: "bg-gray-100 text-gray-600" },
};

interface EmployeeOption {
  id: string;
  name: string;
}

interface Props {
  companyId: string;
  initialLoans: EmployeeLoanRow[];
  employees: EmployeeOption[];
  isAdmin: boolean;
}

export default function LoanTable({ companyId, initialLoans, employees, isAdmin }: Props) {
  const [loans, setLoans] = useState(initialLoans);
  const [showForm, setShowForm] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleCreated(loan: EmployeeLoanRow) {
    setLoans((prev) => [loan, ...prev]);
    setShowForm(false);
  }

  function handleCancel(loanId: string) {
    if (!confirm("¿Cancelar este préstamo? El saldo restante no se cobrará.")) return;
    setCancellingId(loanId);
    startTransition(async () => {
      const result = await cancelLoanAction(companyId, loanId);
      if (result.success) {
        toast.success("Préstamo cancelado.");
        setLoans((prev) =>
          prev.map((l) => (l.id === loanId ? { ...l, status: "CANCELLED" as const } : l))
        );
      } else {
        toast.error(result.error);
      }
      setCancellingId(null);
    });
  }

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <PlusIcon className="h-4 w-4" />
            Nuevo Préstamo
          </button>
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-800">Registrar Préstamo</h3>
          <CreateLoanForm
            companyId={companyId}
            employees={employees}
            onCreated={handleCreated}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {loans.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-400">
          No hay préstamos registrados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Empleado</th>
                <th scope="col" className="px-4 py-3 text-right">Monto Total</th>
                <th scope="col" className="px-4 py-3 text-center">Cuotas</th>
                <th scope="col" className="px-4 py-3 text-right">Cuota</th>
                <th scope="col" className="px-4 py-3 text-right">Saldo Restante</th>
                <th scope="col" className="px-4 py-3 text-center">Estado</th>
                {isAdmin && <th scope="col" className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const statusInfo = STATUS_LABELS[loan.status] ?? { label: loan.status, className: "bg-gray-100 text-gray-600" };
                const currency = loan.currency;
                const symbol = currency === "USD" ? "USD" : "Bs.";
                return (
                  <tr key={loan.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{loan.employeeName}</p>
                      {loan.description && (
                        <p className="text-xs text-gray-400 truncate max-w-xs">{loan.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono">
                      {formatAmount(loan.totalAmount, currency)} {symbol}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {loan.paidInstallments}/{loan.installments}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono">
                      {formatAmount(loan.installmentAmount, currency)} {symbol}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono font-semibold">
                      {formatAmount(loan.remainingBalance, currency)} {symbol}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        {loan.status === "ACTIVE" && (
                          <button
                            onClick={() => handleCancel(loan.id)}
                            disabled={cancellingId === loan.id}
                            aria-busy={cancellingId === loan.id}
                            className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {cancellingId === loan.id && <Loader2Icon className="h-3 w-3 animate-spin" />}
                            Cancelar
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
