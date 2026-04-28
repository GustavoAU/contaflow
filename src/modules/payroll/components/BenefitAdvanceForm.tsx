"use client";
// src/modules/payroll/components/BenefitAdvanceForm.tsx
// Anticipo de Prestaciones Sociales — Art. 144 LOTTT
// Máximo 75% del saldo acumulado. Motivos tasados por ley.

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { registerBenefitAdvanceAction } from "../actions/nom-d.actions";
import type { BenefitAdvanceRow } from "../services/BenefitAdvanceService";

const REASON_LABELS = {
  HOUSING: "Vivienda (adquisición / construcción / remodelación)",
  HEALTH: "Salud (gastos médicos graves)",
  EDUCATION: "Educación (estudios propios o de hijos)",
} as const;

interface Props {
  companyId: string;
  employeeId: string;
  maxAmount: number;
  onRegistered: (advance: BenefitAdvanceRow) => void;
  onCancel: () => void;
}

export default function BenefitAdvanceForm({
  companyId,
  employeeId,
  maxAmount,
  onRegistered,
  onCancel,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<"HOUSING" | "HEALTH" | "EDUCATION">("HOUSING");
  const [notes, setNotes] = useState("");

  const limit75 = (maxAmount * 0.75).toFixed(2);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await registerBenefitAdvanceAction(companyId, {
        employeeId,
        amount,
        reason,
        notes: notes.trim() || null,
      });
      if (result.success) {
        toast.success("Anticipo registrado correctamente");
        onRegistered(result.data);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
        Registrar Anticipo (Art. 144 LOTTT)
      </p>
      <p className="text-xs text-amber-700">
        Máximo permitido: <span className="font-mono font-semibold">{limit75}</span>{" "}
        (75% del saldo de garantía {maxAmount.toLocaleString("es-VE", { minimumFractionDigits: 2 })})
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Monto</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={0.01}
            max={Number(limit75)}
            step={0.01}
            placeholder={`Máx ${limit75}`}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Motivo (Art. 144)</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.entries(REASON_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notas (opcional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          placeholder="Descripción adicional..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Registrando…" : "Confirmar anticipo"}
        </button>
      </div>
    </form>
  );
}
