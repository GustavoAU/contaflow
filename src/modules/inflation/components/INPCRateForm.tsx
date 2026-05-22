"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { upsertINPCRateAction } from "../actions/inpc.actions";

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

type Props = {
  companyId: string;
  onSaved?: () => void;
};

export function INPCRateForm({ companyId, onSaved }: Props) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [value, setValue] = useState("");
  const [source, setSource] = useState("BCV");
  const [error, setError]   = useState<string | null>(null);
  const [isPending, start]  = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await upsertINPCRateAction({ companyId, year, month, indexValue: value, source });
      if (r.success) {
        setValue("");
        onSaved?.();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Año</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          min={2000} max={2100}
          className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Mes</label>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Índice INPC</label>
        <input
          type="number"
          step="0.000001"
          min="0.000001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ej. 1850.523410"
          className="w-40 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Fuente</label>
        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={50}
          className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="flex items-center gap-2 rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
        {isPending ? "Guardando..." : "Guardar Índice"}
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
