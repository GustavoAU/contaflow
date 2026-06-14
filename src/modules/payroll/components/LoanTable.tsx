"use client";
// src/modules/payroll/components/LoanTable.tsx
// Tabla de préstamos con flujo aprobación: PENDING → ADMIN aprueba/rechaza → ACTIVE.

import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { cancelLoanAction, approveLoanAction, rejectLoanAction } from "../actions/employee-loan.actions";
import CreateLoanForm from "./CreateLoanForm";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";
import { formatAmount } from "@/lib/format";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING:   { label: "Pendiente", className: "bg-amber-100 text-amber-800" },
  ACTIVE:    { label: "Activo",    className: "bg-blue-100 text-blue-800" },
  PAID:      { label: "Pagado",    className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "Cancelado", className: "bg-gray-100 text-gray-600" },
  REJECTED:  { label: "Rechazado", className: "bg-red-100 text-red-700" },
};

interface EmployeeOption { id: string; name: string }

interface Props {
  companyId: string;
  initialLoans: EmployeeLoanRow[];
  employees: EmployeeOption[];
  isAdmin: boolean; // ADMIN_ONLY — puede aprobar/rechazar/cancelar
}

export default function LoanTable({ companyId, initialLoans, employees, isAdmin }: Props) {
  const [loans, setLoans] = useState(initialLoans);
  const [showForm, setShowForm] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [, startTransition] = useTransition();

  function handleCreated(loan: EmployeeLoanRow) {
    setLoans((prev) => [loan, ...prev]);
    setShowForm(false);
  }

  function handleApprove(loanId: string) {
    setActionId(loanId);
    startTransition(async () => {
      const result = await approveLoanAction(companyId, loanId);
      if (result.success) {
        toast.success("Préstamo aprobado. Se descontará en la próxima nómina.");
        setLoans((prev) => prev.map((l) => l.id === loanId ? { ...l, ...result.data } : l));
      } else {
        toast.error(result.error);
      }
      setActionId(null);
    });
  }

  function handleRejectSubmit(loanId: string) {
    if (!rejectionReason.trim()) { toast.error("Ingrese el motivo de rechazo."); return; }
    setActionId(loanId);
    startTransition(async () => {
      const result = await rejectLoanAction(companyId, loanId, { rejectionReason });
      if (result.success) {
        toast.success("Préstamo rechazado.");
        setLoans((prev) => prev.map((l) => l.id === loanId ? { ...l, ...result.data } : l));
        setRejectingId(null);
        setRejectionReason("");
      } else {
        toast.error(result.error);
      }
      setActionId(null);
    });
  }

  function handleCancel(loanId: string) {
    if (!confirm("¿Cancelar este préstamo? El saldo restante no se cobrará.")) return;
    setActionId(loanId);
    startTransition(async () => {
      const result = await cancelLoanAction(companyId, loanId);
      if (result.success) {
        toast.success("Préstamo cancelado.");
        setLoans((prev) => prev.map((l) => l.id === loanId ? { ...l, status: "CANCELLED" as const } : l));
      } else {
        toast.error(result.error);
      }
      setActionId(null);
    });
  }

  function currencySymbol(c: string) { return c === "USD" ? "USD" : "Bs."; }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          <PlusIcon className="h-4 w-4" />
          Solicitar Préstamo
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-blue-800">Nuevo Préstamo</h3>
          <CreateLoanForm companyId={companyId} employees={employees}
            onCreated={handleCreated} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Modal rechazo */}
      {rejectingId && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-800">Motivo de rechazo</p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Describa el motivo..."
            className="w-full rounded-md border border-red-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setRejectingId(null); setRejectionReason(""); }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={() => handleRejectSubmit(rejectingId)}
              disabled={actionId === rejectingId}
              aria-busy={actionId === rejectingId}
              className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {actionId === rejectingId && <Loader2Icon className="h-3 w-3 animate-spin" />}
              Confirmar Rechazo
            </button>
          </div>
        </div>
      )}

      {loans.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-sm text-gray-400">
          No hay préstamos registrados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Empleado</th>
                <th scope="col" className="px-4 py-3 text-right">Monto</th>
                <th scope="col" className="px-4 py-3 text-center">Cuotas</th>
                <th scope="col" className="px-4 py-3 text-right">Cuota</th>
                <th scope="col" className="px-4 py-3 text-right">Saldo</th>
                <th scope="col" className="px-4 py-3 text-center">Estado</th>
                {isAdmin && <th scope="col" className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const statusInfo = STATUS_LABELS[loan.status] ?? { label: loan.status, className: "bg-gray-100 text-gray-600" };
                const isMixed = loan.currency === "MIXED";
                const isUsd = loan.currency === "USD";
                return (
                  <tr key={loan.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{loan.employeeName}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <span className="text-xs text-gray-400">{isMixed ? "Mixto" : isUsd ? "USD" : "Bs."}</span>
                        {loan.interestRate && (
                          <span className="text-xs bg-amber-100 text-amber-700 rounded px-1">
                            {(parseFloat(loan.interestRate) * 100).toFixed(1)}% anual
                          </span>
                        )}
                        {loan.description && <span className="text-xs text-gray-400 truncate max-w-32">{loan.description}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">
                      {!isUsd && <p>Bs. {formatAmount(loan.totalAmount, "VES")}</p>}
                      {(isUsd || isMixed) && loan.amountUsd && <p>USD {formatAmount(loan.amountUsd, "USD")}</p>}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-xs">
                      {loan.paidInstallments}/{loan.installments}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs">
                      {!isUsd && <p>Bs. {formatAmount(loan.installmentAmount, "VES")}</p>}
                      {(isUsd || isMixed) && loan.installmentAmountUsd && <p>USD {formatAmount(loan.installmentAmountUsd, "USD")}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-xs font-semibold">
                      {!isUsd && <p>Bs. {formatAmount(loan.remainingBalance, "VES")}</p>}
                      {(isUsd || isMixed) && loan.remainingBalanceUsd && <p>USD {formatAmount(loan.remainingBalanceUsd, "USD")}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      {loan.status === "REJECTED" && loan.rejectionReason && (
                        <p className="text-xs text-red-500 mt-0.5 max-w-28 truncate">{loan.rejectionReason}</p>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {loan.status === "PENDING" && (
                            <>
                              <button onClick={() => handleApprove(loan.id)}
                                disabled={actionId === loan.id}
                                aria-busy={actionId === loan.id}
                                className="inline-flex items-center gap-1 rounded border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50">
                                {actionId === loan.id
                                  ? <Loader2Icon className="h-3 w-3 animate-spin" />
                                  : <CheckCircle2Icon className="h-3 w-3" />}
                                Aprobar
                              </button>
                              <button onClick={() => setRejectingId(loan.id)}
                                disabled={actionId === loan.id}
                                className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                                <XCircleIcon className="h-3 w-3" />
                                Rechazar
                              </button>
                            </>
                          )}
                          {loan.status === "ACTIVE" && (
                            <button onClick={() => handleCancel(loan.id)}
                              disabled={actionId === loan.id}
                              aria-busy={actionId === loan.id}
                              className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                              {actionId === loan.id && <Loader2Icon className="h-3 w-3 animate-spin" />}
                              Cancelar
                            </button>
                          )}
                        </div>
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
