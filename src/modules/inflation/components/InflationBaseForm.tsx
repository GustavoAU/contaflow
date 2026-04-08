"use client";

import { useState, useTransition } from "react";
import { setInflationBaseAction } from "../actions/inpc.actions";

const MONTHS = [
  "","Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

type Props = {
  companyId: string;
  currentBaseYear: number | null;
  currentBaseMonth: number | null;
};

export function InflationBaseForm({ companyId, currentBaseYear, currentBaseMonth }: Props) {
  const [year, setYear]   = useState(currentBaseYear ?? 2018);
  const [month, setMonth] = useState(currentBaseMonth ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, start] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setInflationBaseAction({ companyId, inflationBaseYear: year, inflationBaseMonth: month });
      if (r.success) setSaved(true);
      else setError(r.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Año base</label>
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
        <label className="block text-xs font-medium text-gray-600 mb-1">Mes base</label>
        <select
          value={month}
          onChange={(e) => setMonth(parseInt(e.target.value))}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {MONTHS.slice(1).map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-gray-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Guardando..." : "Guardar Base"}
      </button>
      {saved && <span className="text-xs text-green-600">Período base actualizado</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
