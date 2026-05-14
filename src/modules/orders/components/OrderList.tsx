"use client";
// src/modules/orders/components/OrderList.tsx

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { approveOrderAction, convertOrderToInvoiceAction, cloneOrderAction } from "../actions/order.actions";
import type { OrderRow } from "../services/OrderService";
import { formatAmount } from "@/lib/format";

interface Props {
  companyId: string;
  orders: OrderRow[];
  canApprove: boolean;   // ACCOUNTANT+
  canOperate: boolean;   // ADMINISTRATIVE+
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT:     { label: "Borrador",    cls: "bg-gray-100 text-gray-700" },
  APPROVED:  { label: "Aprobada",    cls: "bg-green-100 text-green-800" },
  CONVERTED: { label: "Convertida",  cls: "bg-blue-100 text-blue-800" },
  CANCELLED: { label: "Cancelada",   cls: "bg-gray-200 text-gray-500" },
};

const TYPE_BADGE: Record<string, string> = {
  PURCHASE: "bg-purple-100 text-purple-700",
  SALE:     "bg-teal-100 text-teal-700",
};

function ConvertModal({
  order,
  companyId,
  onClose,
}: {
  order: OrderRow;
  companyId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [controlNumber, setControlNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]!);
  const [dueDate, setDueDate] = useState("");

  const inputCls = "w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await convertOrderToInvoiceAction(companyId, {
        orderId: order.id,
        invoiceNumber,
        controlNumber: controlNumber || undefined,
        date,
        dueDate: dueDate || undefined,
      });
      if (r.success) {
        toast.success(`Factura creada (ID: ${r.data.invoiceId.slice(0, 8)}…)`);
        onClose();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          Convertir {order.number} a Factura
        </h3>
        <form onSubmit={handleConvert} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>N° Factura *</label>
              <input
                className={inputCls}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="F-0001"
                required
              />
            </div>
            <div>
              <label className={labelCls}>N° Control SENIAT</label>
              <input
                className={inputCls}
                value={controlNumber}
                onChange={(e) => setControlNumber(e.target.value)}
                placeholder="00-000001"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha *</label>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Fecha de vencimiento</label>
              <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Convirtiendo…" : "Convertir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function OrderList({ companyId, orders, canApprove, canOperate }: Props) {
  const [isPending, startTransition] = useTransition();
  const [convertingOrder, setConvertingOrder] = useState<OrderRow | null>(null);

  function handleApprove(orderId: string) {
    startTransition(async () => {
      const r = await approveOrderAction(companyId, orderId);
      if (r.success) toast.success("Orden aprobada");
      else toast.error(r.error);
    });
  }

  function handleClone(orderId: string) {
    startTransition(async () => {
      const r = await cloneOrderAction(companyId, orderId);
      if (r.success) toast.success(`Orden clonada: ${r.data.number}`);
      else toast.error(r.error);
    });
  }

  if (orders.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No hay órdenes registradas.</p>;
  }

  return (
    <>
      {convertingOrder && (
        <ConvertModal
          order={convertingOrder}
          companyId={companyId}
          onClose={() => setConvertingOrder(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {["N°", "Tipo", "Contraparte", "Fecha esperada", "Total", "Estado", "Acciones"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {orders.map((o) => {
              const badge = STATUS_BADGE[o.status] ?? { label: o.status, cls: "bg-gray-100 text-gray-700" };
              const today = new Date().toISOString().split("T")[0]!;
              const isExpired =
                o.expectedDate &&
                o.expectedDate < today &&
                (o.status === "DRAFT" || o.status === "APPROVED");
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{o.number}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[o.type] ?? ""}`}>
                      {o.type === "PURCHASE" ? "OC" : "OV"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{o.counterpartName}</div>
                    {o.counterpartRif && (
                      <div className="text-xs text-gray-400">{o.counterpartRif}</div>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${isExpired ? "text-red-600 font-medium" : "text-gray-600"}`}>
                    {o.expectedDate ?? "—"}
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-right cursor-help"
                    title={`Base: ${formatAmount(o.subtotal)} + IVA: ${formatAmount(o.taxAmount)} = Total: ${formatAmount(o.total)}`}
                  >
                    {o.currency} {formatAmount(o.total)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {isExpired && (
                        <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">
                          Vencida
                        </span>
                      )}
                      {o.approvedAt && (
                        <span className="text-xs text-zinc-400" title={`Aprobado por ${o.approvedBy ?? "—"}`}>
                          Aprobado {new Date(o.approvedAt).toLocaleDateString("es-VE")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 flex-wrap">
                      {canApprove && o.status === "DRAFT" && (
                        <button
                          onClick={() => handleApprove(o.id)}
                          disabled={isPending}
                          className="rounded border border-green-500 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                        >
                          Aprobar
                        </button>
                      )}
                      {canApprove && o.status === "APPROVED" && (
                        <button
                          onClick={() => setConvertingOrder(o)}
                          className="rounded border border-blue-500 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          → Factura
                        </button>
                      )}
                      {canOperate && (
                        <button
                          onClick={() => handleClone(o.id)}
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
    </>
  );
}
