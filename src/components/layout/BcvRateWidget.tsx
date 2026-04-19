// src/components/layout/BcvRateWidget.tsx
// Widget compacto en el header que muestra la tasa USD/VES (BCV) más reciente.
// Al montar: lee de la BD. Botón ↻ dispara auto-fetch desde dolarapi.com y guarda en BD.
"use client";

import { useState, useEffect, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchBcvRateAction,
  getLatestRateAction,
} from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = { companyId: string };

export function BcvRateWidget({ companyId }: Props) {
  const [rate, setRate] = useState<string | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void getLatestRateAction(companyId, "USD").then((res) => {
      if (res.success && res.data) {
        setRate(res.data.rate);
        setRateDate(normalizeDate(res.data.date));
      }
    });
  }, [companyId]);

  function handleRefresh() {
    setError(null);
    startTransition(async () => {
      const res = await fetchBcvRateAction(companyId);
      if (res.success && res.data) {
        setRate(res.data.rate);
        setRateDate(normalizeDate(res.data.date));
      } else if (!res.success) {
        setError(res.error ?? "Error al obtener tasa");
      }
    });
  }

  // No renderizar hasta que haya tasa en BD (evita parpadeo de placeholder vacío)
  if (!rate) return null;

  const formattedRate = parseFloat(rate).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <div
        className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs"
        title={rateDate ? `Tasa BCV del ${rateDate}` : "Tasa BCV USD/VES"}
      >
        <span className="font-medium text-zinc-400">BCV</span>
        <span className="font-mono font-semibold text-zinc-800">$ {formattedRate}</span>
        {rateDate && (
          <span className="text-zinc-400">{formatDisplayDate(rateDate)}</span>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          title="Actualizar tasa desde BCV"
          className="ml-0.5 rounded p-0.5 text-zinc-400 transition-colors hover:text-blue-600 disabled:cursor-wait"
          aria-label="Actualizar tasa BCV"
        >
          <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <span className="max-w-32 truncate text-xs text-red-500" title={error}>
          Sin conexión BCV
        </span>
      )}
    </div>
  );
}

function normalizeDate(d: unknown): string {
  if (typeof d === "string") return d.split("T")[0];
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}

/** Muestra "19 abr" en lugar de "2026-04-19" para ahorrar espacio */
function formatDisplayDate(iso: string): string {
  try {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toLocaleDateString("es-VE", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}
