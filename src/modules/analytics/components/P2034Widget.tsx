// src/modules/analytics/components/P2034Widget.tsx
// Widget de monitoreo de conflictos de concurrencia Serializable (P2034).
// Solo visible para OWNER/ADMIN. Se oculta si no hay conflictos en los últimos 7 días.

import type { P2034DayCount } from "../actions/p2034-counters.actions";

type Props = { data: P2034DayCount[] };

export function P2034Widget({ data }: Props) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const alertLevel =
    total > 10
      ? { label: "Alta frecuencia", cls: "bg-red-100 text-red-700" }
      : total > 3
        ? { label: "Frecuencia moderada", cls: "bg-amber-100 text-amber-700" }
        : { label: "Frecuencia baja", cls: "bg-green-100 text-green-700" };

  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b px-5 py-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-700">
            Conflictos de Concurrencia (P2034)
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Últimos 7 días · {total} evento{total !== 1 ? "s" : ""} · NC/ND y retenciones
          </p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${alertLevel.cls}`}
        >
          {alertLevel.label}
        </span>
      </div>
      <div className="px-5 py-4 space-y-2">
        {data.map(({ date, count }) => (
          <div key={date} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 font-mono text-xs text-zinc-400">{date}</span>
            <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${count > 0 ? "bg-amber-400" : ""}`}
                style={{ width: `${(count / maxCount) * 100}%` }}
              />
            </div>
            <span
              className={`w-5 text-right font-mono text-xs ${
                count > 0 ? "text-amber-700 font-semibold" : "text-zinc-300"
              }`}
            >
              {count}
            </span>
          </div>
        ))}
        {total > 10 && (
          <p className="mt-3 text-xs text-red-600 border-t pt-3">
            Frecuencia alta — considera activar la Opción B (advisory locks) si persiste.
          </p>
        )}
      </div>
    </div>
  );
}
