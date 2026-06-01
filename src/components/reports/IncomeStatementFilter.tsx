"use client";

// src/components/reports/IncomeStatementFilter.tsx
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
  defaultCmpFrom?: string;
  defaultCmpTo?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = { label: string; key: string; range: () => { from: string; to: string; cmpFrom: string; cmpTo: string } };

const PRESETS: Preset[] = [
  {
    label: "Este mes vs. mes anterior",
    key: "month-vs-prev",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateStr(now),
        cmpFrom: toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        cmpTo: toDateStr(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    label: "Este mes vs. mismo mes año anterior",
    key: "month-vs-year-ago",
    range: () => {
      const now = new Date();
      const prevYear = now.getFullYear() - 1;
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateStr(now),
        cmpFrom: toDateStr(new Date(prevYear, now.getMonth(), 1)),
        cmpTo: toDateStr(new Date(prevYear, now.getMonth() + 1, 0)),
      };
    },
  },
  {
    label: "Este año vs. año anterior",
    key: "year-vs-prev",
    range: () => {
      const now = new Date();
      const y = now.getFullYear();
      return {
        from: toDateStr(new Date(y, 0, 1)),
        to: toDateStr(now),
        cmpFrom: toDateStr(new Date(y - 1, 0, 1)),
        cmpTo: toDateStr(new Date(y - 1, 11, 31)),
      };
    },
  },
];

export function IncomeStatementFilter({ defaultFrom = "", defaultTo = "", defaultCmpFrom = "", defaultCmpTo = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [cmpFrom, setCmpFrom] = useState(defaultCmpFrom);
  const [cmpTo, setCmpTo] = useState(defaultCmpTo);

  function navigate(f: string, t: string, cf: string, ct: string) {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (cf) params.set("cmpFrom", cf);
    if (ct) params.set("cmpTo", ct);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply() {
    navigate(from, to, cmpFrom, cmpTo);
  }

  function clear() {
    setFrom(""); setTo(""); setCmpFrom(""); setCmpTo("");
    router.push(pathname);
  }

  function applyPreset(preset: Preset) {
    const r = preset.range();
    setFrom(r.from); setTo(r.to); setCmpFrom(r.cmpFrom); setCmpTo(r.cmpTo);
    navigate(r.from, r.to, r.cmpFrom, r.cmpTo);
  }

  function isActive(preset: Preset): boolean {
    const r = preset.range();
    return defaultFrom === r.from && defaultTo === r.to && defaultCmpFrom === r.cmpFrom && defaultCmpTo === r.cmpTo;
  }

  const hasFilter = Boolean(defaultFrom || defaultTo || defaultCmpFrom || defaultCmpTo);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => applyPreset(preset)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive(preset)
                ? "bg-zinc-900 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Período actual</p>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Desde</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Hasta</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400" />
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Período a comparar (opcional)</p>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Desde</label>
              <input type="date" value={cmpFrom} onChange={(e) => setCmpFrom(e.target.value)}
                className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Hasta</label>
              <input type="date" value={cmpTo} onChange={(e) => setCmpTo(e.target.value)}
                className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={apply}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
          Filtrar
        </button>
        {hasFilter && (
          <button onClick={clear} className="text-sm text-zinc-500 underline hover:text-zinc-800">
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}
