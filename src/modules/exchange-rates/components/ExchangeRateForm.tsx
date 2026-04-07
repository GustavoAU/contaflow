"use client";

import { useTransition, useState } from "react";
import { upsertExchangeRateAction, fetchBcvRateAction } from "../actions/exchange-rate.actions";
import type { ExchangeRateSummary } from "../services/ExchangeRateService";

type Props = {
  companyId: string;
  userId: string;
  onSuccess?: (rate: ExchangeRateSummary) => void;
};

const today = () => new Date().toISOString().split("T")[0];

export function ExchangeRateForm({ companyId, userId, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [isBcvPending, startBcvTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bcvSuccess, setBcvSuccess] = useState(false);

  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(today());

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setBcvSuccess(false);

    startTransition(async () => {
      const result = await upsertExchangeRateAction({
        companyId,
        currency,
        rate,
        date,
        source: "BCV",
        createdBy: userId,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        setSuccess(true);
        setRate("");
        setDate(today());
        onSuccess?.(result.data);
      }
    });
  }

  function handleFetchBcv() {
    setError(null);
    setSuccess(false);
    setBcvSuccess(false);

    startBcvTransition(async () => {
      const result = await fetchBcvRateAction(companyId);

      if (!result.success) {
        setError(result.error);
      } else {
        setBcvSuccess(true);
        onSuccess?.(result.data);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Registrar tasa BCV</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Ingrese el tipo de cambio oficial BCV del día.
          </p>
        </div>
        <button
          type="button"
          onClick={handleFetchBcv}
          disabled={isBcvPending || isPending}
          aria-label="Obtener tasa USD/VES actualizada desde el BCV automáticamente"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {isBcvPending ? (
            <>
              <span
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
                aria-hidden="true"
              />
              Consultando BCV…
            </>
          ) : (
            <>
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Actualizar desde BCV
            </>
          )}
        </button>
      </div>

      {/* Moneda */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">Moneda</label>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as "USD" | "EUR")}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        >
          <option value="USD">USD — Dólar estadounidense</option>
          <option value="EUR">EUR — Euro</option>
        </select>
      </div>

      {/* Tasa */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">
          Tasa BCV (1 {currency} = ? VES)
        </label>
        <input
          type="number"
          step="0.000001"
          min="0.000001"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="Ej: 46.50"
          required
          className="w-full rounded-md border border-zinc-200 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Fecha */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-zinc-700">Fecha</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Tasa guardada correctamente.
        </div>
      )}
      {bcvSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Tasa USD/VES del BCV actualizada automáticamente.
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Guardando..." : "Guardar tasa"}
      </button>
    </form>
  );
}
