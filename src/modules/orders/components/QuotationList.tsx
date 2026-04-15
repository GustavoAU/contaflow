"use client";
// src/modules/orders/components/QuotationList.tsx

import { useTransition } from "react";
import { toast } from "sonner";
import {
  submitForApprovalAction,
  approveQuotationAction,
  rejectQuotationAction,
} from "../actions/quotation.actions";
import type { QuotationRow } from "../services/QuotationService";

interface Props {
  companyId: string;
  quotations: QuotationRow[];
  canApprove: boolean;   // ACCOUNTANT+
  canOperate: boolean;   // ADMINISTRATIVE+
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT:            { label: "Borrador",       cls: "bg-gray-100 text-gray-700" },
  PENDING_APPROVAL: { label: "Pend. Aprob.",   cls: "bg-amber-100 text-amber-800" },
  APPROVED:         { label: "Aprobada",       cls: "bg-green-100 text-green-800" },
  REJECTED:         { label: "Rechazada",      cls: "bg-red-100 text-red-700" },
  CANCELLED:        { label: "Cancelada",      cls: "bg-gray-200 text-gray-500" },
  CONVERTED:        { label: "Convertida",     cls: "bg-blue-100 text-blue-800" },
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
            {["N°", "Tipo", "Contraparte", "Válida hasta", "Total", "Estado", "Acciones"].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {quotations.map((q) => {
            const badge = STATUS_BADGE[q.status] ?? { label: q.status, cls: "bg-gray-100 text-gray-700" };
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
                <td className="px-4 py-3 text-gray-600">{q.validUntil}</td>
                <td className="px-4 py-3 font-mono text-right">
                  {q.currency} {Number(q.total).toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                    {badge.label}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
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
