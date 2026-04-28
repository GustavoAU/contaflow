"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  {
    label: "Este mes",
    key: "this-month",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toDateStr(now),
      };
    },
  },
  {
    label: "Mes anterior",
    key: "last-month",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toDateStr(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    label: "Trim. actual",
    key: "this-quarter",
    range: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: toDateStr(new Date(now.getFullYear(), q * 3, 1)),
        to: toDateStr(now),
      };
    },
  },
  {
    label: "Año actual",
    key: "this-year",
    range: () => {
      const now = new Date();
      return {
        from: toDateStr(new Date(now.getFullYear(), 0, 1)),
        to: toDateStr(now),
      };
    },
  },
];

export function DateRangeFilter({ defaultFrom = "", defaultTo = "" }: Props) {
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

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const { from: f, to: t } = preset.range();
    setFrom(f);
    setTo(t);
    navigate(f, t);
  }

  function isActive(preset: (typeof PRESETS)[number]): boolean {
    const { from: f, to: t } = preset.range();
    return defaultFrom === f && defaultTo === t;
  }

  const hasFilter = Boolean(defaultFrom || defaultTo);

  return (
    <div className="space-y-3">
      {/* Accesos rápidos */}
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

      {/* Filtro manual por fecha */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-500">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <button
          onClick={apply}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Filtrar
        </button>
        {hasFilter && (
          <button
            onClick={clear}
            className="text-sm text-zinc-500 underline hover:text-zinc-800"
          >
            Limpiar filtro
          </button>
        )}
      </div>
    </div>
  );
}
