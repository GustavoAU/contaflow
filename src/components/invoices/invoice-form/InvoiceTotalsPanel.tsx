// src/components/invoices/invoice-form/InvoiceTotalsPanel.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
"use client";

import { formatCurrencyAmount } from "./helpers";
import type { IGTFCalculation } from "@/modules/igtf/services/IGTFService";

type Props = {
  subtotal: string;
  totalIva: string;
  totalAmount: string;
  currency: "VES" | "USD" | "EUR";
  igtfCalculation: IGTFCalculation | null;
};

export function InvoiceTotalsPanel({
  subtotal,
  totalIva,
  totalAmount,
  currency,
  igtfCalculation,
}: Props) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 space-y-2">
      <p className="text-sm font-semibold text-zinc-700">Resumen</p>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-zinc-500">Subtotal (Base Imponible)</span>
          <span className="font-mono font-medium text-zinc-800 tabular-nums">
            {formatCurrencyAmount(subtotal, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-500">Total IVA</span>
          <span className="font-mono font-medium text-zinc-800 tabular-nums">
            {formatCurrencyAmount(totalIva, currency)}
          </span>
        </div>
        {igtfCalculation && (
          <div className="flex justify-between">
            <span className="text-zinc-500">IGTF (3%)</span>
            <span className="font-mono font-medium text-yellow-700 tabular-nums">
              {formatCurrencyAmount(igtfCalculation.igtfAmount, currency)}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-zinc-200 pt-2">
          <span className="font-semibold text-zinc-700">Total a Pagar</span>
          <span className="font-mono font-bold text-blue-700 tabular-nums">
            {formatCurrencyAmount(totalAmount, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
