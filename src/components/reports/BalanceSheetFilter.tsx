"use client";

// src/components/reports/BalanceSheetFilter.tsx
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  defaultTo?: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = { label: string; key: string; date: () => string };

const PRESETS: Preset[] = [
  {
    label: "Hoy",
    key: "today",
    date: () => toDateStr(new Date()),
  },
  {
    label: "Fin del mes",
    key: "end-month",
    date: () => {
      const now = new Date();
      return toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    },
  },
  {
    label: "Fin del trimestre",
    key: "end-quarter",
    date: () => {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return toDateStr(new Date(now.getFullYear(), (q + 1) * 3, 0));
    },
  },
  {
    label: "Fin del año",
    key: "end-year",
    date: () => toDateStr(new Date(new Date().getFullYear(), 11, 31)),
  },
];

export function BalanceSheetFilter({ defaultTo = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [to, setTo] = useState(defaultTo);

  function navigate(t: string) {
    const params = new URLSearchParams();
    if (t) params.set("to", t);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply() {
    navigate(to);
  }

  function clear() {
    setTo("");
    router.push(pathname);
  }

  function applyPreset(preset: Preset) {
    const d = preset.date();
    setTo(d);
    navigate(d);
  }

  function isActive(preset: Preset): boolean {
    return defaultTo === preset.date();
  }

  const hasFilter = Boolean(defaultTo);

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
          <label className="text-xs text-zinc-500">Fecha de corte</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <button
          onClick={apply}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Aplicar
        </button>
        {hasFilter && (
          <button onClick={clear} className="text-sm text-zinc-500 underline hover:text-zinc-800">
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
