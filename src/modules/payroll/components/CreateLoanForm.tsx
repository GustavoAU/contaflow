"use client";
// src/modules/payroll/components/CreateLoanForm.tsx
// Formulario para otorgar un préstamo a un empleado.
// La cuota se calcula client-side (preview) pero el server recalcula y persiste.

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { createLoanAction } from "../actions/employee-loan.actions";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";
import { formatAmount } from "@/lib/format";

interface EmployeeOption {
  id: string;
  name: string;
}

interface Props {
  companyId: string;
  employees: EmployeeOption[];
  onCreated: (loan: EmployeeLoanRow) => void;
  onCancel: () => void;
}

export default function CreateLoanForm({ companyId, employees, onCreated, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [currency, setCurrency] = useState<"VES" | "USD">("VES");
  const [installments, setInstallments] = useState("12");
  const [description, setDescription] = useState("");

  const totalNum = parseFloat(totalAmount);
  const installmentsNum = parseInt(installments, 10);
  const installmentPreview =
    !isNaN(totalNum) && !isNaN(installmentsNum) && installmentsNum > 0
      ? Math.ceil((totalNum / installmentsNum) * 100) / 100
      : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLoanAction(companyId, {
        employeeId,
        totalAmount,
        currency,
        installments: installmentsNum,
        description: description.trim() || null,
      });
      if (result.success) {
        toast.success("Préstamo registrado correctamente.");
        onCreated(result.data);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Empleado */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Empleado</label>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Seleccione un empleado...</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </div>

      {/* Monto total + Moneda */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Monto Total</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            required
            placeholder="0.00"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "VES" | "USD")}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="VES">Bs. (VES)</option>
            <option value="USD">$ (USD)</option>
          </select>
        </div>
      </div>

      {/* Cuotas */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Número de Cuotas
        </label>
        <input
          type="number"
          min="1"
          max="120"
          step="1"
          value={installments}
          onChange={(e) => setInstallments(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {installmentPreview !== null && (
          <p className="mt-1 text-xs text-gray-500">
            Cuota estimada:{" "}
            <span className="font-semibold">
              {formatAmount(installmentPreview, currency)} {currency === "VES" ? "Bs." : "USD"}
            </span>
            {" "}(primera cuota se descuenta en la siguiente nómina)
          </p>
        )}
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Descripción <span className="text-gray-400">(opcional)</span>
        </label>
        <input
          type="text"
          maxLength={255}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Motivo del préstamo..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Registrar Préstamo
        </button>
      </div>
    </form>
  );
}
