"use client";

// src/components/reports/TrialBalanceFilter.tsx
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = { label: string; key: string; range: () => { from: string; to: string } };

const PRESETS: Preset[] = [
  {
    label: "Este mes",
    key: "this-month",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    },
  },
  {
    label: "Mes anterior",
    key: "prev-month",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toDateStr(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    label: "Este trimestre",
    key: "this-quarter",
    range: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: toDateStr(new Date(now.getFullYear(), q * 3, 1)),
        to: toDateStr(new Date(now.getFullYear(), (q + 1) * 3, 0)),
      };
    },
  },
  {
    label: "Este año",
    key: "this-year",
    range: () => {
      const y = new Date().getFullYear();
      return {
        from: toDateStr(new Date(y, 0, 1)),
        to: toDateStr(new Date(y, 11, 31)),
      };
    },
  },
];

export function TrialBalanceFilter({ defaultFrom = "", defaultTo = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function navigate(f: string, t: string) {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply() {
    navigate(from, to);
  }

  function clear() {
    setFrom("");
    setTo("");
    router.push(pathname);
  }

  function applyPreset(preset: Preset) {
    const r = preset.range();
    setFrom(r.from);
    setTo(r.to);
    navigate(r.from, r.to);
  }

  function isActive(preset: Preset): boolean {
    const r = preset.range();
    return defaultFrom === r.from && defaultTo === r.to;
  }

  const hasFilter = Boolean(defaultFrom || defaultTo);

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

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-w-36 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <button
          onClick={apply}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
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
