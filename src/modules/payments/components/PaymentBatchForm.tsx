"use client";

import { useTransition, useState } from "react";
import { Loader2Icon, PlusIcon, TrashIcon } from "lucide-react";
import { Decimal } from "decimal.js";
import {
  createPaymentBatchAction,
  applyPaymentBatchAction,
  UnpaidPurchaseInvoice,
} from "../actions/payment-batch.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";

type Props = {
  companyId: string;
  invoices: UnpaidPurchaseInvoice[];
  onSuccess?: () => void;
};

type Line = {
  key: number;
  invoiceId: string;
  amountVes: string;
};

function fmtVes(v: string) {
  const n = parseFloat(v);
  return isNaN(n)
    ? v
    : new Intl.NumberFormat("es-VE", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
}

function genIdempotencyKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

let lineKeySeq = 0;

export function PaymentBatchForm({ companyId, invoices, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethodType>("TRANSFERENCIA");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [originBank, setOriginBank] = useState("");
  const [destBank, setDestBank] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);

  const invoiceMap = new Map(invoices.map((inv) => [inv.id, inv]));
  const usedInvoiceIds = new Set(lines.map((l) => l.invoiceId).filter(Boolean));

  function addLine() {
    setLines((prev) => [...prev, { key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: number, field: "invoiceId" | "amountVes", value: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const updated = { ...l, [field]: value };
        // Auto-fill amount with pending balance when invoice is selected
        if (field === "invoiceId" && value) {
          const inv = invoiceMap.get(value);
          if (inv) updated.amountVes = new Decimal(inv.pendingAmount).toFixed(2);
        }
        return updated;
      })
    );
  }

  function fillMaxAmount(key: number, invoiceId: string) {
    const inv = invoiceMap.get(invoiceId);
    if (!inv) return;
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, amountVes: new Decimal(inv.pendingAmount).toFixed(2) } : l))
    );
  }

  const totalVes = lines.reduce((sum, l) => {
    try {
      const d = new Decimal(l.amountVes || "0");
      return sum.plus(d.gt(0) ? d : 0);
    } catch {
      return sum;
    }
  }, new Decimal(0));

  const canSubmit =
    !isPending &&
    lines.length > 0 &&
    lines.every((l) => { try { return l.invoiceId && new Decimal(l.amountVes || "0").gt(0); } catch { return false; } }) &&
    totalVes.gt(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const idempotencyKey = genIdempotencyKey();

      const createResult = await createPaymentBatchAction({
        companyId,
        method,
        totalAmountVes: totalVes.toFixed(4),
        date,
        referenceNumber: referenceNumber || undefined,
        originBank: originBank || undefined,
        destBank: destBank || undefined,
        notes: notes || undefined,
        idempotencyKey,
        lines: lines.map((l) => ({
          invoiceId: l.invoiceId,
          amountVes: new Decimal(l.amountVes).toFixed(4),
        })),
      });

      if (!createResult.success) {
        setError(createResult.error);
        return;
      }

      const applyResult = await applyPaymentBatchAction({
        companyId,
        batchId: createResult.data.id,
      });

      if (!applyResult.success) {
        setError(`Lote creado pero no aplicado: ${applyResult.error}`);
        return;
      }

      setSuccess(true);
      setLines([{ key: ++lineKeySeq, invoiceId: "", amountVes: "" }]);
      setReferenceNumber("");
      setOriginBank("");
      setDestBank("");
      setNotes("");
      onSuccess?.();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-zinc-800">Distribución de Pago A/P</h2>
      <p className="text-xs text-zinc-500">
        Crea un lote de pago que cancela múltiples facturas de proveedor con un solo comprobante.
      </p>

      {/* Fecha + Método */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Fecha</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Medio de pago</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethodType)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethodType[]).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Referencia bancaria — siempre visible para Transferencia y PagoMóvil */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            Referencia{method === "PAGOMOVIL" && <span className="text-red-500"> *</span>}
          </label>
          <input
            type="text"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="REF-00123456"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Banco origen</label>
          <input
            type="text"
            value={originBank}
            onChange={(e) => setOriginBank(e.target.value)}
            placeholder="Banesco"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-zinc-700">Banco destino</label>
          <input
            type="text"
            value={destBank}
            onChange={(e) => setDestBank(e.target.value)}
            placeholder="BDV"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Líneas */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-700">
            Facturas a pagar <span className="text-red-500">*</span>
          </label>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          >
            <PlusIcon className="size-3" />
            Agregar factura
          </button>
        </div>

        {invoices.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-center text-sm text-zinc-400">
            No hay facturas de proveedor pendientes de pago.
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              const inv = invoiceMap.get(line.invoiceId);
              return (
                <div key={line.key} className="flex items-start gap-2">
                  <div className="flex-1">
                    <select
                      value={line.invoiceId}
                      onChange={(e) => updateLine(line.key, "invoiceId", e.target.value)}
                      required
                      className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">— Seleccionar factura —</option>
                      {invoices.map((inv) => (
                        <option
                          key={inv.id}
                          value={inv.id}
                          disabled={usedInvoiceIds.has(inv.id) && inv.id !== line.invoiceId}
                        >
                          {inv.invoiceNumber} — {inv.counterpartName} (Bs.D {fmtVes(inv.pendingAmount)})
                        </option>
                      ))}
                    </select>
                    {inv && (
                      <p className="mt-0.5 text-xs text-zinc-400">
                        Saldo pendiente: Bs.D {fmtVes(inv.pendingAmount)} /{" "}
                        {inv.date}
                      </p>
                    )}
                  </div>
                  <div className="w-36">
                    <div className="relative">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.amountVes}
                        onChange={(e) => updateLine(line.key, "amountVes", e.target.value)}
                        placeholder="0.00"
                        required
                        className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    {inv && (
                      <button
                        type="button"
                        onClick={() => fillMaxAmount(line.key, line.invoiceId)}
                        className="mt-0.5 text-xs text-blue-500 hover:underline"
                      >
                        Máximo
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    className="mt-1.5 rounded p-1 text-zinc-400 hover:text-red-500 disabled:opacity-30"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Total */}
      {totalVes.gt(0) && (
        <div className="flex justify-end rounded-md bg-zinc-50 px-4 py-3">
          <span className="text-sm font-medium text-zinc-700">
            Total lote:{" "}
            <span className="font-mono font-bold text-zinc-900">
              Bs.D {fmtVes(totalVes.toFixed(2))}
            </span>
          </span>
        </div>
      )}

      {/* Notas */}
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">Notas (opcional)</label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones..."
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          Lote aplicado correctamente. Las facturas fueron actualizadas.
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        aria-busy={isPending}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending && <Loader2Icon className="size-4 animate-spin" />}
        {isPending ? "Aplicando lote..." : "Crear y Aplicar Lote"}
      </button>
    </form>
  );
}
