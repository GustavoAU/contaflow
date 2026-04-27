"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
}

export function DateRangeFilter({ defaultFrom = "", defaultTo = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function apply() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function clear() {
    setFrom("");
    setTo("");
    router.push(pathname);
  }

  const hasFilter = Boolean(defaultFrom || defaultTo);

  return (
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
  );
}
