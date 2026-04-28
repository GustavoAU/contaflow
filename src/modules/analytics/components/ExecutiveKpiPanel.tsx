"use client";

// src/modules/analytics/components/ExecutiveKpiPanel.tsx
// Panel de KPIs ejecutivos: CxC, CxP, DSO, capital de trabajo + flujo proyectado.

import { useState, useTransition } from "react";
import { TrendingUp, TrendingDown, Clock, Wallet, RefreshCw, Loader2Icon } from "lucide-react";
import { getKpiDashboardAction } from "../actions/kpi-dashboard.actions";
import type { KpiDashboardData } from "../actions/kpi-dashboard.actions";

type Props = {
  companyId: string;
  initialData: KpiDashboardData;
};

function fmt(value: string): string {
  return Number(value).toLocaleString("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function NetBadge({ value }: { value: string }) {
  const num = Number(value);
  const isPositive = num >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-semibold ${
        isPositive ? "text-green-600" : "text-red-600"
      }`}
    >
      {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
      {isPositive ? "+" : ""}
      {fmt(value)}
    </span>
  );
}

export function ExecutiveKpiPanel({ companyId, initialData }: Props) {
  const [data, setData] = useState<KpiDashboardData>(initialData);
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    startTransition(async () => {
      const r = await getKpiDashboardAction(companyId);
      if (r.success) setData(r.data);
    });
  }

  const { summary, cashFlow } = data;
  const workingPositive = Number(summary.workingCapital) >= 0;

  return (
    <div className="space-y-4">
      {/* ─── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          KPIs Ejecutivos
        </h2>
        <button
          onClick={handleRefresh}
          disabled={isPending}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {/* ─── 4 KPI cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* CxC */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Por Cobrar (CxC)</p>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-600">{fmt(summary.cxcTotal)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Bs. pendientes de clientes</p>
        </div>

        {/* CxP */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Por Pagar (CxP)</p>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-red-600">{fmt(summary.cxpTotal)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Bs. comprometidos a proveedores</p>
        </div>

        {/* Capital de trabajo */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Capital de Trabajo</p>
            <Wallet className={`h-4 w-4 ${workingPositive ? "text-blue-500" : "text-red-500"}`} />
          </div>
          <p
            className={`mt-2 text-2xl font-bold ${
              workingPositive ? "text-blue-600" : "text-red-600"
            }`}
          >
            {workingPositive ? "+" : ""}
            {fmt(summary.workingCapital)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">CxC − CxP</p>
        </div>

        {/* DSO */}
        <div className="rounded-lg border bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">DSO (Días Cobro)</p>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          {summary.dso !== null ? (
            <>
              <p className="mt-2 text-2xl font-bold">{summary.dso}</p>
              <p className="mt-1 text-xs text-muted-foreground">días promedio de cobro</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold text-zinc-300">—</p>
              <p className="mt-1 text-xs text-muted-foreground">sin ventas últimos 30 días</p>
            </>
          )}
        </div>
      </div>

      {/* ─── Flujo de caja proyectado ───────────────────────────────────────── */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-5 py-3">
          <h3 className="text-sm font-semibold text-zinc-700">
            Flujo de Caja Proyectado (próximos 90 días)
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Basado en vencimientos de facturas activas no pagadas
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-2 text-left font-medium">Ventana</th>
                <th className="px-5 py-2 text-right font-medium text-emerald-600">
                  Cobros esperados
                </th>
                <th className="px-5 py-2 text-right font-medium text-red-600">
                  Pagos comprometidos
                </th>
                <th className="px-5 py-2 text-right font-medium text-zinc-700">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {cashFlow.map((bucket) => (
                <tr key={bucket.label} className="hover:bg-zinc-50">
                  <td className="px-5 py-3 font-medium text-zinc-700">{bucket.label}</td>
                  <td className="px-5 py-3 text-right text-emerald-600">{fmt(bucket.collections)}</td>
                  <td className="px-5 py-3 text-right text-red-600">{fmt(bucket.payments)}</td>
                  <td className="px-5 py-3 text-right">
                    <NetBadge value={bucket.net} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-zinc-50 font-semibold">
                <td className="px-5 py-3 text-zinc-700">Total 90d</td>
                <td className="px-5 py-3 text-right text-emerald-700">
                  {fmt(
                    cashFlow
                      .reduce((acc, b) => acc + Number(b.collections), 0)
                      .toFixed(2),
                  )}
                </td>
                <td className="px-5 py-3 text-right text-red-700">
                  {fmt(
                    cashFlow
                      .reduce((acc, b) => acc + Number(b.payments), 0)
                      .toFixed(2),
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <NetBadge
                    value={cashFlow
                      .reduce((acc, b) => acc + Number(b.net), 0)
                      .toFixed(2)}
                  />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
