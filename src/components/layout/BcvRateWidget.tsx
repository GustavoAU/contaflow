"use client";

import { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  fetchBcvRateAction,
  fetchBcvEurRateAction,
  type RateWithDelta,
} from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = {
  companyId: string;
  variant?: "light" | "dark";
  /** Tasas obtenidas en el server (layout). Evita despachar una Server Action en el montaje,
      que disparaba el bug de Next useActionQueue/useOptimistic ("Rendered more hooks"). */
  initialUsd?: RateWithDelta | null;
  initialEur?: RateWithDelta | null;
};

// ─── Formato helpers ───────────────────────────────────────────────────────────

function fmtRate(rate: string) {
  return parseFloat(rate).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDelta(delta: string | null | undefined) {
  if (!delta) return null;
  const n = parseFloat(delta);
  if (n === 0) return null;
  const abs = Math.abs(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { text: `${n > 0 ? "+" : "−"}${abs}`, up: n > 0 };
}

function formatDate(d: Date | string): string {
  try {
    const iso = typeof d === "string" ? d : d.toISOString();
    const [year, month, day] = iso.split("T")[0]!.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString("es-VE", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  } catch {
    return String(d);
  }
}

// ─── BcvRateWidget ─────────────────────────────────────────────────────────────
// Pill compacto (solo USD) con hover/focus tooltip que muestra USD + EUR + refresh.

export function BcvRateWidget({ companyId, variant = "light", initialUsd = null, initialEur = null }: Props) {
  const [usd, setUsd] = useState<RateWithDelta | null>(initialUsd);
  const [eur, setEur] = useState<RateWithDelta | null>(initialEur);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // Las tasas iniciales llegan como props desde el server (layout). El botón "Actualizar"
  // sigue usando fetchBcvRateAction/fetchBcvEurRateAction (acciones de mutación, por click).

  // Cerrar al click fuera o Escape — no se cierra por hover/scroll
  const closeTooltip = useCallback(() => setShowTooltip(false), []);
  useEffect(() => {
    if (!showTooltip) return;
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeTooltip();
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") closeTooltip();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [showTooltip, closeTooltip]);

  function handleRefresh(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const [resUsd, resEur] = await Promise.all([
        fetchBcvRateAction(companyId),
        fetchBcvEurRateAction(companyId),
      ]);
      if (resUsd.success) {
        const usdDelta = usd
          ? (parseFloat(resUsd.data.rate) - parseFloat(usd.rate)).toFixed(4)
          : null;
        setUsd({ ...resUsd.data, delta: usdDelta });
      } else {
        toast.error(`Tasa USD: ${resUsd.error}`);
      }
      if (resEur.success) {
        const eurDelta = eur
          ? (parseFloat(resEur.data.rate) - parseFloat(eur.rate)).toFixed(4)
          : null;
        setEur({ ...resEur.data, delta: eurDelta });
      } else {
        toast.error(`Tasa EUR: ${resEur.error}`);
      }
    });
  }

  if (!usd) return null;

  const isDark = variant === "dark";
  const usdDelta = fmtDelta(usd.delta);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      {/* ── Pill compacto ───────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowTooltip((v) => !v)}
        aria-label="Ver tasas BCV — click para abrir/cerrar"
        aria-expanded={showTooltip}
        aria-haspopup="true"
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-1",
          isDark
            ? "border-slate-600 bg-slate-700/50 hover:border-slate-500 focus-visible:ring-offset-slate-800"
            : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 focus-visible:ring-offset-white"
        )}
      >
        {/* Label BCV */}
        <span className={cn("text-10 font-semibold", isDark ? "text-slate-400" : "text-zinc-400")}>
          BCV
        </span>

        {/* USD rate */}
        <span className={cn("font-mono font-semibold tabular-nums text-xs", isDark ? "text-slate-100" : "text-zinc-800")}>
          {fmtRate(usd.rate)}
        </span>

        {/* Delta arrow (solo si hay variación) */}
        {usdDelta && (
          <span className={cn(
            "flex items-center text-10 tabular-nums font-mono",
            usdDelta.up
              ? (isDark ? "text-emerald-400" : "text-emerald-600")
              : (isDark ? "text-red-400" : "text-red-500")
          )}>
            {usdDelta.up
              ? <TrendingUp className="h-2.5 w-2.5" aria-hidden />
              : <TrendingDown className="h-2.5 w-2.5" aria-hidden />
            }
          </span>
        )}
      </button>

      {/* ── Tooltip con detalle completo ─────────────────────────────────────── */}
      {showTooltip && (
        <div
          role="tooltip"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border shadow-xl",
            "animate-in fade-in slide-in-from-top-1 duration-150",
            isDark
              ? "border-slate-600 bg-slate-800 text-slate-200"
              : "border-zinc-200 bg-white text-zinc-800"
          )}
        >
          <div className="px-3 py-2.5 space-y-2">
            {/* Fecha */}
            <p className={cn("text-10 font-medium", isDark ? "text-slate-500" : "text-zinc-400")}>
              Tasas BCV al {formatDate(usd.date)}
            </p>

            {/* USD row */}
            <TooltipRateRow label="USD" rate={usd} dark={isDark} />

            {/* EUR row */}
            {eur && <TooltipRateRow label="EUR" rate={eur} dark={isDark} />}

            {/* Divider + refresh */}
            <div className={cn("border-t pt-2 flex items-center justify-end", isDark ? "border-slate-700" : "border-zinc-100")}>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isPending}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-10 font-medium transition-colors disabled:cursor-wait",
                  isDark
                    ? "text-slate-400 hover:text-blue-400 hover:bg-slate-700"
                    : "text-zinc-400 hover:text-blue-600 hover:bg-zinc-50"
                )}
              >
                <RefreshCw className={cn("h-3 w-3", isPending && "animate-spin")} />
                Actualizar tasas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Fila de tasa en el tooltip ────────────────────────────────────────────────

function TooltipRateRow({ label, rate, dark }: { label: string; rate: RateWithDelta; dark: boolean }) {
  const delta = fmtDelta(rate.delta);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={cn("text-xs font-semibold", dark ? "text-slate-300" : "text-zinc-600")}>
        {label}/VES
      </span>
      <div className="flex items-center gap-1.5">
        <span className={cn("font-mono font-bold tabular-nums text-sm", dark ? "text-white" : "text-zinc-900")}>
          Bs. {fmtRate(rate.rate)}
        </span>
        {delta && (
          <span className={cn(
            "font-mono text-10 tabular-nums",
            delta.up
              ? (dark ? "text-emerald-400" : "text-emerald-600")
              : (dark ? "text-red-400" : "text-red-500")
          )}>
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}
