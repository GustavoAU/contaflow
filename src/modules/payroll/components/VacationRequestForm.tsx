"use client";
// src/modules/payroll/components/VacationRequestForm.tsx
// Feature 8: formulario para crear solicitudes de vacaciones.

import { useState, useTransition } from "react";
import { createVacationRequestAction } from "../actions/vacation-request.actions";
import type { VacationBalanceRow } from "../services/VacationRequestService";

type Props = {
  companyId: string;
  employeeId: string;
  balance: VacationBalanceRow;
  onSuccess?: () => void;
};

export function VacationRequestForm({ companyId, employeeId, balance, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    startDate: "",
    endDate: "",
    daysRequested: "",
    notes: "",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createVacationRequestAction(companyId, {
        employeeId,
        startDate: form.startDate,
        endDate: form.endDate,
        daysRequested: form.daysRequested,
        notes: form.notes || undefined,
      });
      if (!res.success) {
        setError(res.error);
      } else {
        setSuccess(true);
        setForm({ startDate: "", endDate: "", daysRequested: "", notes: "" });
        onSuccess?.();
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        Solicitud enviada correctamente. Pendiente de aprobación.
        <button
          className="ml-3 underline"
          onClick={() => setSuccess(false)}
        >
          Nueva solicitud
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <strong>{balance.daysAvailable}</strong> días disponibles
        {balance.daysPending > 0 && (
          <span className="ml-2 text-xs text-amber-600">
            ({balance.daysPending} en espera de aprobación)
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Fecha inicio
          </label>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            required
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1">
            Fecha fin
          </label>
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            required
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-600 mb-1">
          Días a disfrutar
        </label>
        <input
          type="number"
          min="1"
          step="0.5"
          value={form.daysRequested}
          onChange={(e) => set("daysRequested", e.target.value)}
          required
          placeholder="ej. 15"
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-zinc-400">
          Días hábiles (excluye sábados, domingos y feriados)
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-600 mb-1">
          Observaciones (opcional)
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="ej. Vacaciones anuales reglamentarias"
          className="w-full rounded border px-3 py-2 text-sm resize-none"
        />
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Enviando…" : "Solicitar vacaciones"}
      </button>
    </form>
  );
}
