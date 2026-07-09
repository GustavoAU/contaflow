// src/components/invoices/invoice-form/InvoiceRetentionsIgtfSection.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
// Estado y handlers viven en el contenedor; aquí solo llegan por props.
"use client";

import type { IGTFCalculation } from "@/modules/igtf/services/IGTFService";

type Props = {
  type: "SALE" | "PURCHASE";
  paidInForeign: boolean;
  setPaidInForeign: (value: boolean) => void;
  igtfApplies: boolean;
  igtfBase: string;
  setIgtfBase: (value: string) => void;
  igtfCalculation: IGTFCalculation | null;
};

export function InvoiceRetentionsIgtfSection({
  type,
  paidInForeign,
  setPaidInForeign,
  igtfApplies,
  igtfBase,
  setIgtfBase,
  igtfCalculation,
}: Props) {
  return (
    <>
      {/* Retenciones */}
      <div className="space-y-3 rounded-lg bg-orange-50 p-4">
        <p className="text-sm font-semibold text-orange-700">Retenciones</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Monto IVA Retenido
            </label>
            <input
              name="ivaRetentionAmount"
              type="number"
              step="0.01"
              defaultValue="0"
              className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              N° Comprobante Retención IVA
            </label>
            <input
              name="ivaRetentionVoucher"
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
              placeholder="Opcional"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Fecha Comprobante Retención IVA
            </label>
            <input
              name="ivaRetentionDate"
              type="date"
              className="w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
            />
          </div>
          {type === "PURCHASE" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Monto ISLR Retenido
              </label>
              <input
                name="islrRetentionAmount"
                type="number"
                step="0.01"
                defaultValue="0"
                className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-orange-400 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* IGTF — Ventas y Compras en divisas (H-003) */}
      <div className="space-y-3 rounded-lg bg-yellow-50 p-4">
        <p className="text-sm font-semibold text-yellow-700">Detalle de Pago / IGTF</p>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={paidInForeign}
            onChange={(e) => setPaidInForeign(e.target.checked)}
            className="rounded"
          />
          {type === "SALE" ? "Pago recibido en divisas" : "Pago realizado en divisas"}
        </label>
          {igtfApplies && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Base IGTF (3%)
                  <span className="ml-1 font-normal text-zinc-400">(subtotal + IVA)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={igtfBase}
                  onChange={(e) => setIgtfBase(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-yellow-500 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Monto IGTF Percibido
                </label>
                <input
                  type="text"
                  value={igtfCalculation?.igtfAmount ?? "0.00"}
                  readOnly
                  className="w-full rounded-md border bg-yellow-100 px-3 py-2 font-mono text-sm font-semibold text-yellow-800"
                />
              </div>
            </div>
          )}
      </div>
    </>
  );
}
