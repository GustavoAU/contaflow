"use client";
// src/modules/budgets/components/CashFlowWidget.tsx
// Q3-3: Proyección de Flujo de Caja 30/60/90 días — widget cliente.

import { useState, useTransition, useCallback } from "react";
import { RefreshCwIcon, TrendingUpIcon, TrendingDownIcon, AlertTriangleIcon } from "lucide-react";
import { toast } from "sonner";
import type { CashFlowProjection } from "../services/BudgetService";
import { getCashFlowProjectionAction } from "../actions/budget.actions";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBs(amount: string): string {
  const n = parseFloat(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function netColor(amount: string): string {
  const n = parseFloat(amount);
  if (isNaN(n) || n === 0) return "text-zinc-600";
  return n > 0 ? "text-emerald-700" : "text-red-700";
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  companyId: string;
  initial: CashFlowProjection;
};

export function CashFlowWidget({ companyId, initial }: Props) {
  const [data, setData] = useState<CashFlowProjection>(initial);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      const r = await getCashFlowProjectionAction(companyId);
      if (!r.success) { toast.error(r.error); return; }
      setData(r.data);
      toast.success("Proyección actualizada");
    });
  }, [companyId]);

  const hasActivity = data.buckets.some((b) => b.invoiceCount > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Basado en facturas UNPAID/PARTIAL con fecha de vencimiento. Solo en Bs. (VES).
        </p>
        <button
          onClick={refresh}
          disabled={isPending}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
          title="Actualizar proyección"
        >
          <RefreshCwIcon className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {!hasActivity ? (
        <div className="flex flex-col items-center justify-center py-8 text-zinc-400 space-y-2">
          <AlertTriangleIcon className="size-6 text-zinc-300" />
          <p className="text-sm">No hay facturas con fecha de vencimiento registrada en los próximos 90 días.</p>
          <p className="text-xs">Registra fechas de vencimiento en tus facturas de venta y compra para ver la proyección.</p>
        </div>
      ) : (
        <>
          {/* Buckets grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.buckets.map((bucket) => {
              const isOverdue = bucket.label === "Vencido";
              return (
                <div
                  key={bucket.label}
                  className={`rounded-lg border p-3 ${isOverdue && parseFloat(bucket.cxpAmount) > 0 ? "border-red-200 bg-red-50" : "border-zinc-100 bg-zinc-50"}`}
                >
                  <p className={`text-xs font-medium mb-2 ${isOverdue ? "text-red-700" : "text-zinc-600"}`}>
                    {bucket.label}
                  </p>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-0.5 text-emerald-600">
                        <TrendingUpIcon className="size-3" />CxC
                      </span>
                      <span className="font-medium text-emerald-700">{fmtBs(bucket.cxcAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-0.5 text-red-500">
                        <TrendingDownIcon className="size-3" />CxP
                      </span>
                      <span className="font-medium text-red-600">{fmtBs(bucket.cxpAmount)}</span>
                    </div>
                    <div className="border-t border-zinc-200 pt-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Neto</span>
                      <span className={`font-bold ${netColor(bucket.netAmount)}`}>
                        {parseFloat(bucket.netAmount) >= 0 ? "+" : ""}{fmtBs(bucket.netAmount)}
                      </span>
                    </div>
                    {bucket.invoiceCount > 0 && (
                      <p className="text-10 text-zinc-400 text-right">{bucket.invoiceCount} factura{bucket.invoiceCount !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Totals row */}
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-zinc-500 mb-0.5">Total CxC (90d)</p>
              <p className="font-bold text-emerald-700">Bs. {fmtBs(data.totalCxC)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-0.5">Total CxP (90d)</p>
              <p className="font-bold text-red-600">Bs. {fmtBs(data.totalCxP)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-0.5">Flujo neto estimado</p>
              <p className={`font-bold text-lg ${netColor(data.totalNet)}`}>
                {parseFloat(data.totalNet) >= 0 ? "+" : ""}Bs. {fmtBs(data.totalNet)}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
