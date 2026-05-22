"use client";
// src/modules/payroll/components/TerminationForm.tsx
// Fase NOM-D: Formulario para crear liquidación final (DRAFT)
// idempotencyKey generado client-side (UUID v4) para prevenir doble-submit

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createTerminationAction } from "../actions/nom-d.actions";

interface EmployeeOption {
  id: string;
  fullName: string;
}

interface Props {
  companyId: string;
  employees: EmployeeOption[];
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const REASONS = [
  { value: "RESIGNATION", label: "Renuncia voluntaria" },
  { value: "DISMISSAL_JUSTIFIED", label: "Despido justificado" },
  { value: "DISMISSAL_UNJUSTIFIED", label: "Despido injustificado (doble prestación)" },
  { value: "CONTRACT_END", label: "Fin de contrato" },
  { value: "MUTUAL_AGREEMENT", label: "Mutuo acuerdo" },
];

export default function TerminationForm({ companyId, employees }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("RESIGNATION");
  const [terminationDate, setTerminationDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [idempotencyKey] = useState(generateUUID);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) {
      toast.error("Selecciona un empleado");
      return;
    }
    startTransition(async () => {
      const result = await createTerminationAction(companyId, employeeId, {
        reason,
        terminationDate,
        idempotencyKey,
      });
      if (result.success) {
        toast.success("Liquidación creada como borrador");
        router.push(`/company/${companyId}/payroll/terminations/${result.data.id}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Empleado
        </label>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          <option value="">— Seleccionar empleado —</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.fullName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Causa de egreso
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {reason === "DISMISSAL_UNJUSTIFIED" && (
          <p className="mt-1 text-xs text-amber-600">
            Art. 92 LOTTT: la indemnización equivale al doble de las prestaciones acumuladas.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Fecha de egreso
        </label>
        <input
          type="date"
          value={terminationDate}
          onChange={(e) => setTerminationDate(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Calculando…" : "Calcular liquidación"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
