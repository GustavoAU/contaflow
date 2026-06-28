"use client";

// src/modules/payments/components/PaymentRecordList.tsx
// Tabla "Últimos pagos registrados" con botón Anular (#14), overflow-x-auto (#10) y adjuntos (ADR-029)

import { useState, useTransition, useEffect, useCallback, Fragment } from "react";
import { Loader2Icon, PaperclipIcon, ChevronDownIcon } from "lucide-react";
import { voidPaymentRecordAction, getPaymentAttachmentsAction } from "../actions/payment.actions";
import { PAYMENT_METHOD_LABELS, PaymentMethodType } from "../schemas/payment.schema";
import type { PaymentRecordSummary } from "../services/PaymentService";
import type { AttachmentSummary } from "../services/PaymentAttachmentService";
import { UploadAttachmentButton } from "./UploadAttachmentButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnalyzeReceiptButton } from "./AnalyzeReceiptButton";

const METHOD_BADGE: Record<PaymentMethodType, string> = {
  EFECTIVO:      "bg-zinc-100 text-zinc-600",
  TRANSFERENCIA: "bg-blue-100 text-blue-700",
  PAGOMOVIL:     "bg-indigo-100 text-indigo-700",
  ZELLE:         "bg-green-100 text-green-700",
  CASHEA:        "bg-purple-100 text-purple-700",
};

function fmtVes(v: string) {
  const n = parseFloat(v);
  return isNaN(n) ? v : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function VoidModal({
  onConfirm,
  onCancel,
  isPending,
}: {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-lg">
        <h3 className="mb-3 font-semibold text-zinc-800">Anular pago</h3>
        <p className="mb-4 text-sm text-zinc-600">
          El pago quedará marcado como anulado. Debería registrar el asiento inverso manualmente si el monto
          ya fue contabilizado.
        </p>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Motivo <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: Referencia duplicada"
          autoFocus
          className="mb-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {/* HA-04: explicar por qué el botón Confirmar está deshabilitado con motivo vacío */}
        <p className={`mb-4 text-xs ${reason.trim() ? "text-zinc-400" : "text-amber-600"}`}>
          El motivo de anulación es obligatorio.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={isPending}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirm(reason)}
            disabled={isPending || !reason.trim()} aria-busy={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {isPending && <Loader2Icon className="size-4 animate-spin" />}
            {isPending ? "Anulando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componente: panel de adjuntos por fila (lazy load) ──────────────────

function PaymentRowAttachments({
  companyId,
  paymentRecordId,
  canDelete,
}: {
  companyId: string;
  paymentRecordId: string;
  canDelete: boolean;
}) {
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    const result = await getPaymentAttachmentsAction(companyId, paymentRecordId);
    setAttachments(result.success ? result.data : []);
    setLoading(false);
  }, [companyId, paymentRecordId]);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-zinc-400">
        <Loader2Icon className="size-3.5 animate-spin" />
        Cargando...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <UploadAttachmentButton
        companyId={companyId}
        paymentRecordId={paymentRecordId}
        existingAttachments={attachments}
        canDelete={canDelete}
        onUploaded={fetchAttachments}
        onDeleted={fetchAttachments}
      />
      {/* ADR-030 D-4: botón "Analizar con IA" sobre el primer adjunto activo */}
      {attachments.length > 0 && (
        <AnalyzeReceiptButton
          companyId={companyId}
          attachmentId={attachments[0].id}
        />
      )}
    </div>
  );
}

type Props = {
  companyId: string;
  payments: PaymentRecordSummary[];
  canDelete?: boolean; // true si el rol puede eliminar comprobantes (OWNER/ADMIN/ACCOUNTANT)
  onVoided?: () => void;
};

export function PaymentRecordList({ companyId, payments, canDelete = false, onVoided }: Props) {
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleVoidConfirm(reason: string) {
    if (!voidingId) return;
    setError(null);
    startTransition(async () => {
      const result = await voidPaymentRecordAction(companyId, voidingId, reason);
      setVoidingId(null);
      if (result.success) {
        onVoided?.();
      } else {
        setError(result.error);
      }
    });
  }

  if (payments.length === 0) {
    return (
      <EmptyState
        illustration="list"
        title="No hay pagos registrados aún"
        description="Los cobros y pagos a clientes y proveedores aparecerán aquí cuando registres el primero."
      />
    );
  }

  return (
    <>
      {voidingId && (
        <VoidModal
          onConfirm={handleVoidConfirm}
          onCancel={() => setVoidingId(null)}
          isPending={isPending}
        />
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {/* overflow-x-auto (#10) */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-170 text-sm">
          <thead className="border-b bg-zinc-50 text-xs font-medium uppercase text-zinc-500">
            <tr>
              {/* toggle expand */}
              <th className="w-8 px-3 py-3" />
              <th className="px-4 py-3 text-left">Fecha</th>
              <th className="px-4 py-3 text-left">Método</th>
              <th className="px-4 py-3 text-right">Monto Bs.D</th>
              <th className="px-4 py-3 text-right">USD</th>
              <th className="px-4 py-3 text-right">IGTF</th>
              <th className="px-4 py-3 text-left">Ref.</th>
              <th className="px-4 py-3 text-left">Concepto</th>
              <th className="w-20 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {payments.map((p) => (
              <Fragment key={p.id}>
                <tr className="hover:bg-zinc-50">
                  {/* expand / comprobante toggle */}
                  <td className="px-3 py-3 text-zinc-400">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                      title={expandedId === p.id ? "Ocultar comprobante" : "Ver / Adjuntar comprobante"}
                      className="rounded p-0.5 hover:text-zinc-700"
                    >
                      {expandedId === p.id ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <PaperclipIcon className="size-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                    {new Date(p.date).toLocaleDateString("es-VE")}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${METHOD_BADGE[p.method as PaymentMethodType] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethodType] ?? p.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmtVes(p.amountVes)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-green-700">
                    {p.amountOriginal ? `$${fmtVes(p.amountOriginal)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-amber-700">
                    {p.igtfAmount ? fmtVes(p.igtfAmount) : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {p.referenceNumber ?? "—"}
                    {p.senderPhone && (
                      <span className="ml-1 text-zinc-400">· Tel: {p.senderPhone}</span>
                    )}
                  </td>
                  <td className="max-w-36 px-4 py-3 text-xs text-zinc-500">
                    <span className="line-clamp-1" title={p.notes ?? undefined}>{p.notes ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setVoidingId(p.id)}
                      disabled={isPending}
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      Anular
                    </button>
                  </td>
                </tr>
                {/* Panel de comprobante — expandible */}
                {expandedId === p.id && (
                  <tr key={`${p.id}-attach`} className="bg-zinc-50">
                    <td colSpan={9} className="px-8 py-3">
                      <p className="mb-2 text-xs font-medium uppercase text-zinc-500">Comprobante</p>
                      <PaymentRowAttachments
                        companyId={companyId}
                        paymentRecordId={p.id}
                        canDelete={canDelete}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
