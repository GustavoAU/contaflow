"use client";
// src/modules/payroll/components/CreateLoanForm.tsx
// Formulario para registrar un préstamo patronal.
// Soporta VES / USD / MIXTO y cálculo de cuota con método francés cuando hay interés.

import { useState, useTransition } from "react";
import { Loader2Icon, InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { createLoanAction } from "../actions/employee-loan.actions";
import type { EmployeeLoanRow } from "../services/EmployeeLoanService";

interface EmployeeOption { id: string; name: string }

interface Props {
  companyId: string;
  employees: EmployeeOption[];
  onCreated: (loan: EmployeeLoanRow) => void;
  onCancel: () => void;
}

// Método francés client-side (preview)
function calcFrenchInstallment(principal: number, installments: number, annualRate: number): number {
  if (annualRate === 0 || !annualRate) {
    return Math.ceil((principal / installments) * 100) / 100;
  }
  const r = annualRate / 12;
  const rn = Math.pow(1 + r, installments);
  const cuota = (principal * r * rn) / (rn - 1);
  return Math.ceil(cuota * 100) / 100;
}

const INPUT = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function CreateLoanForm({ companyId, employees, onCreated, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [currency, setCurrency] = useState<"VES" | "USD" | "MIXED">("VES");
  const [totalAmount, setTotalAmount] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [installments, setInstallments] = useState("12");
  const [hasInterest, setHasInterest] = useState(false);
  const [interestRate, setInterestRate] = useState(""); // % anual, ej: "30"
  const [description, setDescription] = useState("");

  const principal = parseFloat(totalAmount);
  const principalUsd = parseFloat(amountUsd);
  const installmentsNum = parseInt(installments, 10);
  const annualRateDecimal = hasInterest ? parseFloat(interestRate || "0") / 100 : 0;

  const installmentPreview =
    !isNaN(principal) && principal > 0 && !isNaN(installmentsNum) && installmentsNum > 0
      ? calcFrenchInstallment(principal, installmentsNum, annualRateDecimal)
      : null;

  const installmentUsdPreview =
    currency === "MIXED" && !isNaN(principalUsd) && principalUsd > 0 && !isNaN(installmentsNum) && installmentsNum > 0
      ? calcFrenchInstallment(principalUsd, installmentsNum, annualRateDecimal)
      : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLoanAction(companyId, {
        employeeId,
        currency,
        totalAmount: currency === "USD" ? amountUsd : totalAmount,
        amountUsd: currency === "MIXED" ? amountUsd : null,
        installments: installmentsNum,
        interestRate: hasInterest && interestRate ? String(parseFloat(interestRate) / 100) : null,
        description: description.trim() || null,
      });
      if (result.success) {
        toast.success("Préstamo enviado a aprobación.");
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
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required className={INPUT}>
          <option value="">Seleccione un empleado...</option>
          {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
      </div>

      {/* Tipo de moneda */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de préstamo</label>
        <div className="flex gap-3">
          {(["VES", "USD", "MIXED"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="currency"
                value={c}
                checked={currency === c}
                onChange={() => { setCurrency(c); setTotalAmount(""); setAmountUsd(""); }}
                className="accent-blue-600"
              />
              <span className="text-sm font-medium text-gray-700">
                {c === "VES" ? "Solo Bs." : c === "USD" ? "Solo USD" : "Mixto (Bs. + USD)"}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Montos */}
      <div className="flex gap-3">
        {(currency === "VES" || currency === "MIXED") && (
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {currency === "MIXED" ? "Monto en Bs." : "Monto Total (Bs.)"}
            </label>
            <input type="number" min="0.01" step="0.01" value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
              placeholder="0.00" className={INPUT} />
          </div>
        )}
        {(currency === "USD" || currency === "MIXED") && (
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {currency === "MIXED" ? "Monto en USD" : "Monto Total (USD)"}
            </label>
            <input type="number" min="0.01" step="0.01" value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              required
              placeholder="0.00" className={INPUT} />
          </div>
        )}
      </div>

      {/* Cuotas */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Número de Cuotas</label>
        <input type="number" min="1" max="120" step="1" value={installments}
          onChange={(e) => setInstallments(e.target.value)}
          required className={INPUT} />
      </div>

      {/* Interés */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={hasInterest}
            onChange={(e) => { setHasInterest(e.target.checked); if (!e.target.checked) setInterestRate(""); }}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-sm font-medium text-gray-700">Préstamo con interés</span>
        </label>

        {hasInterest && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Tasa de interés anual (%)
            </label>
            <input
              type="number"
              min="0.01"
              max="200"
              step="0.01"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              required={hasInterest}
              placeholder="ej: 30"
              className={INPUT}
            />
            <div className="flex items-start gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded p-2">
              <InfoIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Tasa activa BCV referencial: ~59% anual. No hay tope legal específico para préstamos patronales (LOTTT Art. 154
                limita el descuento a 1/3 del salario, no la tasa).
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Preview cuota */}
      {(installmentPreview !== null || installmentUsdPreview !== null) && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm space-y-1">
          <p className="font-medium text-blue-800">Cuota estimada (método francés)</p>
          {installmentPreview !== null && (currency === "VES" || currency === "MIXED") && (
            <p className="text-blue-700">
              Bs.: <span className="font-mono font-semibold">{installmentPreview.toFixed(2)}</span>
              {hasInterest && annualRateDecimal > 0 && (
                <span className="text-blue-500 ml-1">(incluye interés)</span>
              )}
            </p>
          )}
          {installmentUsdPreview !== null && (
            <p className="text-blue-700">
              USD: <span className="font-mono font-semibold">{installmentUsdPreview.toFixed(2)}</span>
              {hasInterest && annualRateDecimal > 0 && (
                <span className="text-blue-500 ml-1">(incluye interés)</span>
              )}
            </p>
          )}
          {currency === "USD" && installmentPreview !== null && (
            <p className="text-blue-700">
              USD: <span className="font-mono font-semibold">{calcFrenchInstallment(parseFloat(amountUsd) || 0, installmentsNum, annualRateDecimal).toFixed(2)}</span>
            </p>
          )}
          <p className="text-xs text-blue-500 mt-1">
            Primera cuota se descuenta en la siguiente nómina aprobada.
            Verificar que no exceda 1/3 del salario neto (LOTTT Art. 154).
          </p>
        </div>
      )}

      {/* Descripción */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Descripción <span className="text-gray-400">(opcional)</span>
        </label>
        <input type="text" maxLength={255} value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Motivo del préstamo..." className={INPUT} />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} disabled={isPending}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={isPending} aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          Enviar a Aprobación
        </button>
      </div>
    </form>
  );
}
