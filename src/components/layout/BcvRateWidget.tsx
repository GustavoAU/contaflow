"use client";

import { useState, useEffect, useTransition } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  fetchBcvRateAction,
  fetchBcvEurRateAction,
  getLatestRatesWithDeltaAction,
  type RateWithDelta,
} from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = { companyId: string };

export function BcvRateWidget({ companyId }: Props) {
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

  return (
    <div className="hidden items-center gap-1 md:flex">
      <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs">
        {usd && <RateTicker label="USD" symbol="$" rate={usd} />}
        {usd && eur && <span className="text-zinc-300">|</span>}
        {eur && <RateTicker label="EUR" symbol="€" rate={eur} />}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isPending}
          title="Actualizar tasas BCV"
          className="ml-0.5 rounded p-0.5 text-zinc-400 transition-colors hover:text-blue-600 disabled:cursor-wait"
          aria-label="Actualizar tasas BCV"
        >
          <RefreshCw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}

function RateTicker({ label, symbol, rate }: { label: string; symbol: string; rate: RateWithDelta }) {
  const delta = rate.delta ? parseFloat(rate.delta) : null;
  const isUp = delta !== null && delta > 0;
  const isDown = delta !== null && delta < 0;

  const dateDisplay = formatDate(rate.date);
  const rawRate = parseFloat(rate.rate);
  const truncated = Math.trunc(rawRate * 10000) / 10000;
  const formattedRate = truncated.toLocaleString("es-VE", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
  const formattedDelta = delta !== null
    ? (isUp ? "+" : "") + (Math.trunc(Math.abs(delta) * 10000) / 10000).toFixed(4)
    : null;

  return (
    <span
      className="flex items-center gap-1"
      title={`${label}/VES — ${dateDisplay}`}
    >
      <span className="font-medium text-zinc-400">{label}</span>
      <span className="font-mono font-semibold text-zinc-800">
        {symbol} {formattedRate}
      </span>
      {formattedDelta && (
        <span className={`flex items-center gap-0.5 font-mono ${isUp ? "text-emerald-600" : isDown ? "text-red-500" : "text-zinc-400"}`}>
          {isUp ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : isDown ? (
            <TrendingDown className="h-2.5 w-2.5" />
          ) : (
            <Minus className="h-2.5 w-2.5" />
          )}
          {formattedDelta}
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
