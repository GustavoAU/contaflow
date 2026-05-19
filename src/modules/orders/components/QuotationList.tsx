"use client";
// src/modules/orders/components/QuotationList.tsx

import { useTransition } from "react";
import { toast } from "sonner";
import { FileIcon, ClockIcon, CheckCircleIcon, XCircleIcon, ArrowRightCircleIcon, type LucideIcon } from "lucide-react";
import {
  submitForApprovalAction,
  approveQuotationAction,
  rejectQuotationAction,
  cloneQuotationAction,
} from "../actions/quotation.actions";
import type { QuotationRow } from "../services/QuotationService";
import { formatAmount, fmtDate } from "@/lib/format";

const CURRENCY_LABEL: Record<string, string> = { VES: "Bs.", USD: "USD $", EUR: "EUR €" };
const fmtCurrency = (code: string, amount: string) =>
  `${CURRENCY_LABEL[code] ?? code} ${formatAmount(amount)}`;

interface Props {
  companyId: string;
  quotations: QuotationRow[];
  canApprove: boolean;   // ACCOUNTANT+
  canOperate: boolean;   // ADMINISTRATIVE+
}

const STATUS_BADGE: Record<string, { label: string; cls: string; Icon: LucideIcon }> = {
  DRAFT:            { label: "Borrador",     cls: "bg-gray-100 text-gray-700",   Icon: FileIcon },
  PENDING_APPROVAL: { label: "Pend. Aprob.", cls: "bg-amber-100 text-amber-800", Icon: ClockIcon },
  APPROVED:         { label: "Aprobada",     cls: "bg-green-100 text-green-800", Icon: CheckCircleIcon },
  REJECTED:         { label: "Rechazada",    cls: "bg-red-100 text-red-700",     Icon: XCircleIcon },
  CANCELLED:        { label: "Cancelada",    cls: "bg-gray-200 text-gray-500",   Icon: XCircleIcon },
  CONVERTED:        { label: "Convertida",   cls: "bg-blue-100 text-blue-800",   Icon: ArrowRightCircleIcon },
};

const TYPE_BADGE: Record<string, string> = {
  PURCHASE: "bg-purple-100 text-purple-700",
  SALE:     "bg-teal-100 text-teal-700",
};

export function QuotationList({ companyId, quotations, canApprove, canOperate }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(quotationId: string) {
    startTransition(async () => {
      const r = await submitForApprovalAction(companyId, quotationId);
      if (r.success) toast.success("Enviado a aprobación");
      else toast.error(r.error);
    });
  }

  function handleApprove(quotationId: string) {
    startTransition(async () => {
      const r = await approveQuotationAction(companyId, quotationId);
      if (r.success) toast.success("Cotización aprobada");
      else toast.error(r.error);
    });
  }

  function handleReject(quotationId: string) {
    startTransition(async () => {
      const r = await rejectQuotationAction(companyId, quotationId);
      if (r.success) toast.success("Cotización rechazada");
      else toast.error(r.error);
    });
  }

  function handleClone(quotationId: string) {
    startTransition(async () => {
      const r = await cloneQuotationAction(companyId, quotationId);
      if (r.success) toast.success(`Cotización clonada: ${r.data.number}`);
      else toast.error(r.error);
    });
  }

  if (quotations.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">No hay cotizaciones registradas.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {["N°", "Tipo", "Contraparte"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
            <th
              className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
              title="Fecha límite de validez de la oferta económica"
            >
              Válida hasta
            </th>
            {["Total", "Estado", "Acciones"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {quotations.map((q) => {
            const badge = STATUS_BADGE[q.status] ?? { label: q.status, cls: "bg-gray-100 text-gray-700", Icon: FileIcon };
            const BadgeIcon = badge.Icon;
            const today = new Date().toISOString().split("T")[0]!;
            const isExpired =
              q.validUntil &&
              q.validUntil < today &&
              (q.status === "DRAFT" || q.status === "PENDING_APPROVAL" || q.status === "APPROVED");
            return (
              <tr key={q.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-blue-700">{q.number}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[q.type] ?? ""}`}>
                    {q.type === "PURCHASE" ? "Compra" : "Venta"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{q.counterpartName}</div>
                  {q.counterpartRif && (
                    <div className="text-xs text-gray-400">{q.counterpartRif}</div>
                  )}
                </td>
                <td className={`px-4 py-3 text-sm ${isExpired ? "font-medium text-red-600" : "text-gray-600"}`}>
                  {q.validUntil ? fmtDate(q.validUntil) : "—"}
                  {isExpired && (
                    <span className="ml-1.5 text-xs font-normal text-red-500">(venc.)</span>
                  )}
                </td>
                <td
                  className="px-4 py-3 font-mono text-right cursor-help"
                  title={`Base: ${fmtCurrency(q.currency, q.subtotal)} + IVA: ${fmtCurrency(q.currency, q.taxAmount)} = Total: ${fmtCurrency(q.currency, q.total)}`}
                >
                  {fmtCurrency(q.currency, q.total)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                      <BadgeIcon className="h-3 w-3" aria-hidden />
                      {badge.label}
                    </span>
                    {q.approvedAt && (
                      <span className="text-xs text-zinc-400" title={`Aprobado por ${q.approvedBy ?? "—"}`}>
                        Aprobado {new Date(q.approvedAt).toLocaleDateString("es-VE")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 flex-wrap">
                    {canOperate && q.status === "DRAFT" && (
                      <button
                        onClick={() => handleSubmit(q.id)}
                        disabled={isPending}
                        className="rounded border border-amber-400 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Enviar
                      </button>
                    )}
                    {canApprove && q.status === "PENDING_APPROVAL" && (
                      <>
                        <button
                          onClick={() => handleApprove(q.id)}
                          disabled={isPending}
                          className="rounded border border-green-500 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => handleReject(q.id)}
                          disabled={isPending}
                          className="rounded border border-red-400 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </>
                    )}
                    {canOperate && (
                      <button
                        onClick={() => handleClone(q.id)}
                        disabled={isPending}
                        title="Crea una copia en Borrador con los mismos datos y un nuevo número"
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Clonar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
