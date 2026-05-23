"use client";

// src/components/invoices/CreditDebitNotesPanel.tsx
// Panel lazy-loaded que muestra las NC/ND vinculadas a una FACTURA original.

import { useState, useTransition } from "react";
import {
  getCreditDebitNotesAction,
  type CreditDebitNoteItem,
} from "@/modules/invoices/actions/invoice.actions";

type Props = {
  companyId: string;
  invoiceId: string;
};

const DOC_LABELS: Record<string, { label: string; color: string }> = {
  NOTA_CREDITO: { label: "NC", color: "bg-green-100 text-green-700" },
  NOTA_DEBITO:  { label: "ND", color: "bg-orange-100 text-orange-700" },
};

const STATUS_LABELS: Record<string, string> = {
  UNPAID:  "Sin pagar",
  PARTIAL: "Parcial",
  PAID:    "Pagada",
  VOIDED:  "Anulada",
};

function fmt(val: string | null): string {
  if (!val) return "—";
  return Number(val).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

export function CreditDebitNotesPanel({ companyId, invoiceId }: Props) {
  const [notes, setNotes] = useState<CreditDebitNoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Carga lazy — solo al montar (panel ya visible)
  if (notes === null && !isPending && !error) {
    startTransition(async () => {
      const r = await getCreditDebitNotesAction(companyId, invoiceId);
      if (r.success) {
        setNotes(r.data);
      } else {
        setError(r.error);
      }
    });
  }

  if (isPending || (notes === null && !error)) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-zinc-500">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-500" />
        Cargando notas…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 text-xs text-red-500">{error}</div>
    );
  }

  if (notes!.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-zinc-400">
        Sin notas de crédito/débito vinculadas
      </div>
    );
  }

  return (
    <div className="bg-zinc-50 px-4 py-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Notas vinculadas ({notes!.length})
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-400">
            <th className="pb-1 text-left font-medium">Tipo</th>
            <th className="pb-1 text-left font-medium">N° Documento</th>
            <th className="pb-1 text-left font-medium">Fecha</th>
            <th className="pb-1 text-left font-medium">Contraparte</th>
            <th className="pb-1 text-right font-medium">Monto Bs.</th>
            <th className="pb-1 text-left font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {notes!.map((note) => {
            const docInfo = DOC_LABELS[note.docType] ?? { label: note.docType, color: "bg-zinc-100 text-zinc-600" };
            return (
              <tr key={note.id} className={note.paymentStatus === "VOIDED" ? "opacity-50" : ""}>
                <td className="py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-10 font-bold ${docInfo.color}`}>
                    {docInfo.label}
                  </span>
                </td>
                <td className="py-1.5 font-mono">{note.invoiceNumber}</td>
                <td className="py-1.5">{note.date}</td>
                <td className="py-1.5 max-w-50 truncate">{note.counterpartName}</td>
                <td className="py-1.5 text-right font-mono">{fmt(note.totalAmountVes)}</td>
                <td className="py-1.5">{STATUS_LABELS[note.paymentStatus] ?? note.paymentStatus}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
