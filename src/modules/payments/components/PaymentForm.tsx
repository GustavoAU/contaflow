"use client";

import { useTransition, useState, useEffect } from "react";
import { createPaymentAction } from "../actions/payment.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";
import { getLatestRateAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";

type Props = {
  companyId: string;
  userId: string;
  onSuccess?: () => void;
};

const IGTF_RATE = 0.03;

export function PaymentForm({ companyId, userId, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Campos comunes
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethodType>("PAGOMOVIL");
  const [amountVes, setAmountVes] = useState("");
  const [notes, setNotes] = useState("");

  // PagoMóvil
  const [referenceNumber, setReferenceNumber] = useState("");
  const [originBank, setOriginBank] = useState("");
  const [destBank, setDestBank] = useState("");

  // Zelle
  const [amountUsd, setAmountUsd] = useState("");
  const [bcvRate, setBcvRate] = useState<number | null>(null);
  const [bcvLoading, setBcvLoading] = useState(false);

  // Cashea
  const [commissionPct, setCommissionPct] = useState("3.50");
  const [casheaIgtf, setCasheaIgtf] = useState(false);

  const vesNum = parseFloat(amountVes) || 0;
  const commPct = parseFloat(commissionPct) || 0;

  const igtfZelle = vesNum > 0 ? (vesNum * IGTF_RATE).toFixed(2) : "0.00";
  const igtfCashea = casheaIgtf && vesNum > 0 ? (vesNum * IGTF_RATE).toFixed(2) : "0.00";
  const commAmount = vesNum > 0 ? ((vesNum * commPct) / 100).toFixed(2) : "0.00";

  // ─── Cargar tasa BCV cuando el método es Zelle ───────────────────────────
  useEffect(() => {
    if (method !== "ZELLE") return;
    void (async () => {
      setBcvRate(null);
      setBcvLoading(true);
      try {
        const res = await getLatestRateAction(companyId, "USD");
        if (res.success && res.data) {
          setBcvRate(parseFloat(res.data.rate));
        }
      } finally {
        setBcvLoading(false);
      }
    })();
  }, [method, companyId]);

  // ─── Auto-calcular VES = USD × tasa BCV ──────────────────────────────────
  useEffect(() => {
    if (method !== "ZELLE" || !bcvRate || !amountUsd) return;
    void (async () => {
      const usdNum = parseFloat(amountUsd);
      if (!isNaN(usdNum) && usdNum > 0) {
        setAmountVes((usdNum * bcvRate).toFixed(2));
      }
    })();
  }, [amountUsd, bcvRate, method]);

  function resetForm() {
    setDate(today);
    setMethod("PAGOMOVIL");
    setAmountVes("");
    setNotes("");
    setReferenceNumber("");
    setOriginBank("");
    setDestBank("");
    setAmountUsd("");
    setBcvRate(null);
    setCommissionPct("3.50");
    setCasheaIgtf(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const payload: Record<string, string | undefined> = {
        companyId,
        method,
        amountVes,
        currency: method === "ZELLE" ? "USD" : "VES",
        date,
        notes: notes || undefined,
        createdBy: userId,
      };

      if (method === "PAGOMOVIL") {
        payload.referenceNumber = referenceNumber;
        payload.originBank = originBank || undefined;
        payload.destBank = destBank || undefined;
      }

      if (method === "ZELLE") {
        payload.amountOriginal = amountUsd;
        payload.igtfAmount = igtfZelle;
      }

      if (method === "CASHEA") {
        payload.commissionPct = commissionPct;
        payload.commissionAmount = commAmount;
        if (casheaIgtf) payload.igtfAmount = igtfCashea;
      }

      const result = await createPaymentAction(payload);
      if (result.success) {
        setSuccess(true);
        resetForm();
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-zinc-800">Registrar Pago</h2>

      {/* Fecha + Método */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Fecha</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Medio de pago</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethodType)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodType[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Zelle ─── */}
      {method === "ZELLE" && (
        <div className="space-y-3 rounded-md border border-green-100 bg-green-50 p-3">
          <p className="text-xs font-medium text-green-700">Datos Zelle (USD)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Monto en USD <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              placeholder="0.00"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Tasa BCV + VES auto-calculado */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Equivalente en Bs.D (VES)
              {bcvLoading && (
                <span className="ml-2 text-xs font-normal text-zinc-400">Cargando tasa BCV...</span>
              )}
              {!bcvLoading && bcvRate && (
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  Tasa BCV: {bcvRate.toFixed(2)} Bs.D/USD
                </span>
              )}
              {!bcvLoading && !bcvRate && (
                <span className="ml-2 text-xs font-normal text-amber-600">
                  Sin tasa BCV registrada — ingrese manualmente
                </span>
              )}
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amountVes}
              onChange={(e) => setAmountVes(e.target.value)}
              placeholder="0.00"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {vesNum > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3% (aplica automáticamente por ser pago en USD):
              <span className="ml-1 font-mono font-semibold">Bs.D {igtfZelle}</span>
            </div>
          )}
        </div>
      )}

      {/* Monto VES (para métodos no-Zelle) */}
      {method !== "ZELLE" && (
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Monto{" "}
            <span className="font-mono text-xs text-zinc-500">Bs.D (VES)</span>
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountVes}
            onChange={(e) => setAmountVes(e.target.value)}
            placeholder="0.00"
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      )}

      {/* ─── PagoMóvil ─── */}
      {method === "PAGOMOVIL" && (
        <div className="space-y-3 rounded-md border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-medium text-blue-700">Datos PagoMóvil</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Número de referencia <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="REF-12345678"
              required
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Banco origen</label>
              <input
                type="text"
                value={originBank}
                onChange={(e) => setOriginBank(e.target.value)}
                placeholder="Banco de Venezuela"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Banco destino</label>
              <input
                type="text"
                value={destBank}
                onChange={(e) => setDestBank(e.target.value)}
                placeholder="Banesco"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* ─── Cashea ─── */}
      {method === "CASHEA" && (
        <div className="space-y-3 rounded-md border border-purple-100 bg-purple-50 p-3">
          <p className="text-xs font-medium text-purple-700">Datos Cashea (BNPL)</p>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              Comisión Cashea (%) <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                className="w-28 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              {vesNum > 0 && (
                <span className="text-sm text-zinc-600">
                  = <span className="font-mono font-semibold">Bs.D {commAmount}</span>
                </span>
              )}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={casheaIgtf}
              onChange={(e) => setCasheaIgtf(e.target.checked)}
              className="rounded"
            />
            Cashea liquida en USD (aplica IGTF 3%)
          </label>
          {casheaIgtf && vesNum > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              IGTF 3%: <span className="font-mono font-semibold">Bs.D {igtfCashea}</span>
            </div>
          )}
        </div>
      )}

      {/* Notas opcionales */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Notas (opcional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones adicionales..."
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Feedback */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Pago registrado correctamente.
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending ? "Guardando..." : "Registrar pago"}
      </button>
    </form>
  );
}
