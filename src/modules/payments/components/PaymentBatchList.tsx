"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { PaymentBatchSummary } from "../services/PaymentBatchService";
import {
  voidPaymentBatchAction,
  applyPaymentBatchAction,
  discardPaymentBatchAction,
} from "../actions/payment-batch.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";

type Props = {
  companyId: string;
  batches: PaymentBatchSummary[];
  onVoided?: () => void;
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700",
  APPLIED: "bg-green-100 text-green-700",
  VOID: "bg-zinc-100 text-zinc-500 line-through",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  APPLIED: "Aplicado",
  VOID: "Anulado",
};

const METHOD_BADGE: Record<PaymentMethodType, string> = {
  EFECTIVO: "bg-zinc-100 text-zinc-600",
  TRANSFERENCIA: "bg-blue-100 text-blue-700",
  PAGOMOVIL: "bg-indigo-100 text-indigo-700",
  ZELLE: "bg-green-100 text-green-700",
  CASHEA: "bg-purple-100 text-purple-700",
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

function VoidModal({
  batchId,
  companyId,
  onConfirm,
  onCancel,
  isPending,
}: {
  batchId: string;
  companyId: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  void batchId;
  void companyId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-lg">
        <h3 className="mb-3 font-semibold text-zinc-800">Anular lote de pago</h3>
        <p className="mb-4 text-sm text-zinc-600">
          Se revertirán todos los pagos aplicados a las facturas de este lote. Esta acción no se
          puede deshacer.
        </p>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Motivo de anulación <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: Error en referencia bancaria"
          autoFocus
          className="mb-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {/* HA-04: explicar por qué el botón Confirmar está deshabilitado con motivo vacío */}
        <p className={`mb-4 text-xs ${reason.trim() ? "text-zinc-400" : "text-amber-600"}`}>
          El motivo de anulación es obligatorio.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={isPending || !reason.trim()}
            aria-busy={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending ? "Anulando..." : "Confirmar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchRow({
  batch,
  companyId,
  onVoided,
}: {
  batch: PaymentBatchSummary;
  companyId: string;
  onVoided?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function handleVoidConfirm(voidReason: string) {
    setError(null);
    startTransition(async () => {
      const result = await voidPaymentBatchAction({
        companyId,
        batchId: batch.id,
        voidReason,
      });
      if (result.success) {
        setShowVoidModal(false);
        onVoided?.();
        router.refresh();
      } else {
        setError(result.error);
        setShowVoidModal(false);
      }
    });
  }

  // HA-02: reintentar la aplicación de un lote que quedó en DRAFT (create OK, apply falló).
  function handleApply() {
    setError(null);
    startTransition(async () => {
      const result = await applyPaymentBatchAction({ companyId, batchId: batch.id });
      if (result.success) {
        onVoided?.();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  // HA-02: descartar un lote DRAFT huérfano (soft-delete; no tocó facturas ni GL).
  function handleDiscard() {
    setError(null);
    startTransition(async () => {
      const result = await discardPaymentBatchAction({ companyId, batchId: batch.id });
      if (result.success) {
        setConfirmingDiscard(false);
        onVoided?.();
        router.refresh();
      } else {
        setError(result.error);
        setConfirmingDiscard(false);
      }
    });
  }

  return (
    <>
      {showVoidModal && (
        <VoidModal
          batchId={batch.id}
          companyId={companyId}
          onConfirm={handleVoidConfirm}
          onCancel={() => setShowVoidModal(false)}
          isPending={isPending}
        />
      )}
      <tr
        className="cursor-pointer hover:bg-zinc-50"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-3 text-zinc-400">
          {expanded ? (
            <ChevronDownIcon className="size-4" />
          ) : (
            <ChevronRightIcon className="size-4" />
          )}
        </td>
        <td className="px-4 py-3 font-mono text-xs text-zinc-600">
          {new Date(batch.date).toLocaleDateString("es-VE", { timeZone: "UTC" })}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${METHOD_BADGE[batch.method as PaymentMethodType] ?? "bg-zinc-100 text-zinc-600"}`}
          >
            {PAYMENT_METHOD_LABELS[batch.method as PaymentMethodType] ?? batch.method}
          </span>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-zinc-500">
          {batch.referenceNumber ?? "—"}
        </td>
        <td className="px-4 py-3 text-center text-sm font-medium text-zinc-700">
          {batch.lines.length}
        </td>
        <td className="px-4 py-3 text-right font-mono font-semibold">
          {fmtVes(batch.totalAmountVes)}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[batch.status] ?? "bg-zinc-100 text-zinc-600"}`}
          >
            {STATUS_LABEL[batch.status] ?? batch.status}
          </span>
        </td>
        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          {batch.status === "APPLIED" && (
            <button
              type="button"
              onClick={() => setShowVoidModal(true)}
              disabled={isPending}
              className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Anular
            </button>
          )}
          {/* HA-02: un lote DRAFT (apply falló) debe poder reintentarse o descartarse */}
          {batch.status === "DRAFT" && !confirmingDiscard && (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={handleApply}
                disabled={isPending}
                aria-busy={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                {isPending && <Loader2Icon className="size-3 animate-spin" />}
                Aplicar
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDiscard(true)}
                disabled={isPending}
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
              >
                Descartar
              </button>
            </div>
          )}
          {batch.status === "DRAFT" && confirmingDiscard && (
            <div className="flex items-center justify-end gap-1.5 text-xs">
              <span className="text-zinc-500">¿Descartar borrador?</span>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isPending}
                aria-busy={isPending}
                className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {isPending && <Loader2Icon className="size-3 animate-spin" />}
                Sí
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDiscard(false)}
                disabled={isPending}
                className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                No
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-zinc-50">
          <td colSpan={8} className="px-8 py-3">
            <p className="mb-2 text-xs font-medium uppercase text-zinc-500">Facturas del lote</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="pb-1 font-normal">Factura</th>
                  <th className="pb-1 text-right font-normal">Monto Bs.D</th>
                  <th className="pb-1 text-right font-normal">IGTF</th>
                  <th className="pb-1 font-normal">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {batch.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1 font-mono text-zinc-600">
                      {l.invoiceNumber ?? l.invoiceId.slice(0, 12) + "…"}
                      {l.counterpartName && (
                        <span className="ml-1 text-zinc-400">({l.counterpartName})</span>
                      )}
                    </td>
                    <td className="py-1 text-right font-mono font-semibold">
                      {fmtVes(l.amountVes)}
                    </td>
                    <td className="py-1 text-right font-mono text-amber-700">
                      {l.igtfAmount ? fmtVes(l.igtfAmount) : "—"}
                    </td>
                    <td className="py-1 text-zinc-400">{l.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {batch.voidReason && (
              <p className="mt-2 text-xs text-red-600">
                Motivo de anulación: {batch.voidReason}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function PaymentBatchList({ companyId, batches, onVoided }: Props) {
  if (batches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-white p-8 text-center">
        <p className="text-sm text-zinc-400">No hay lotes de pago registrados aún</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-175 text-sm">
        <thead className="border-b bg-zinc-50 text-xs font-medium uppercase text-zinc-500">
          <tr>
            <th className="w-8 px-3 py-3" />
            <th className="px-4 py-3 text-left">Fecha</th>
            <th className="px-4 py-3 text-left">Método</th>
            <th className="px-4 py-3 text-left">Ref.</th>
            <th className="px-4 py-3 text-center">Facturas</th>
            <th className="px-4 py-3 text-right">Total Bs.D</th>
            <th className="px-4 py-3 text-left">Estado</th>
            <th className="px-4 py-3 text-right">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              companyId={companyId}
              onVoided={onVoided}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
