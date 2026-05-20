"use client";

import { useState, useEffect, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchBcvRateAction,
  fetchBcvEurRateAction,
  getLatestRatesWithDeltaAction,
  type RateWithDelta,
} from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = { companyId: string; variant?: "light" | "dark" };

export function BcvRateWidget({ companyId, variant = "light" }: Props) {
  const [usd, setUsd] = useState<RateWithDelta | null>(null);
  const [eur, setEur] = useState<RateWithDelta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadRates() {
    const res = await getLatestRatesWithDeltaAction(companyId);
    if (res.success) {
      setUsd(res.data.usd);
      setEur(res.data.eur);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRates();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRefresh() {
    setError(null);
    startTransition(async () => {
      const [resUsd, resEur] = await Promise.all([
        fetchBcvRateAction(companyId),
        fetchBcvEurRateAction(companyId),
      ]);
      if (!resUsd.success) {
        setError(resEur.success ? "Sin conexión BCV (USD)" : "Sin conexión BCV");
        return;
      }
      // Actualizar estado directamente con la data retornada por la action
      // (evita un segundo round-trip a BD que puede devolver datos stale)
      const usdDelta = usd
        ? (parseFloat(resUsd.data.rate) - parseFloat(usd.rate)).toFixed(4)
        : null;
      setUsd({ ...resUsd.data, delta: usdDelta });

      if (resEur.success) {
        const eurDelta = eur
          ? (parseFloat(resEur.data.rate) - parseFloat(eur.rate)).toFixed(4)
          : null;
        setEur({ ...resEur.data, delta: eurDelta });
      }
    });
  }

  if (!usd && !eur) return null;

  const isDark = variant === "dark";

  return (
    <div className="hidden items-center gap-1 md:flex">
      <div className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs",
        isDark
          ? "border-slate-600 bg-slate-700/60"
          : "border-zinc-200 bg-zinc-50"
      )}>
        {usd && <RateTicker label="USD" rate={usd} dark={isDark} />}
        {usd && eur && <span className={isDark ? "text-slate-500" : "text-zinc-300"}>|</span>}
        {eur && <RateTicker label="EUR" rate={eur} dark={isDark} />}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          title="Actualizar tasas BCV"
          className={cn(
            "ml-0.5 rounded p-0.5 transition-colors disabled:cursor-wait",
            isDark
              ? "text-slate-400 hover:text-blue-400"
              : "text-zinc-400 hover:text-blue-600"
          )}
          aria-label="Actualizar tasas BCV"
        >
          <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <span className={cn("text-xs", isDark ? "text-red-400" : "text-red-500")}>{error}</span>
      )}
    </div>
  );
}

function RateTicker({ label, rate, dark = false }: { label: string; rate: RateWithDelta; dark?: boolean }) {
  const delta = rate.delta ? parseFloat(rate.delta) : null;
  const isUp = delta !== null && delta > 0;
  const isDown = delta !== null && delta < 0;

  const dateDisplay = formatDate(rate.date);
  const rawRate = parseFloat(rate.rate);
  const formattedRate = rawRate.toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const absDelta = delta !== null ? Math.abs(delta) : null;
  const formattedDelta = absDelta !== null
    ? `${isUp ? "+" : "−"}${absDelta.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  return (
    <span
      className="flex items-center gap-1"
      title={`${label}/VES al ${dateDisplay}${formattedDelta ? ` · variación: ${formattedDelta} Bs.` : ""}`}
    >
      <span className={dark ? "font-medium text-slate-400" : "font-medium text-zinc-400"}>{label}</span>
      <span className={dark ? "font-mono font-semibold text-slate-100" : "font-mono font-semibold text-zinc-800"}>
        Bs. {formattedRate}
      </span>
      {formattedDelta && (
        <span
          className={cn(
            "font-mono text-[10px]",
            dark
              ? (isUp ? "text-emerald-400" : isDown ? "text-red-400" : "text-slate-400")
              : (isUp ? "text-emerald-600" : isDown ? "text-red-500" : "text-zinc-400")
          )}
        >
          ({formattedDelta} hoy)
        </span>
      )}
    </span>
  );
}

function formatDate(d: Date | string): string {
  try {
    const iso = typeof d === "string" ? d : d.toISOString();
    const [year, month, day] = iso.split("T")[0]!.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    return date.toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: "UTC" });
  } catch {
    return String(d);
  }
}
