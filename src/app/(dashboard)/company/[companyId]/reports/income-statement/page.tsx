// src/app/(dashboard)/company/[companyId]/reports/income-statement/page.tsx
import { getIncomeStatementAction } from "@/modules/accounting/actions/report.actions";
import type { IncomeStatement } from "@/modules/accounting/actions/report.actions";
import { ExportFinancialPDFButton } from "@/modules/accounting/components/ExportFinancialPDFButton";
import { IncomeStatementFilter } from "@/components/reports/IncomeStatementFilter";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { fmtVen } from "@/lib/fmt-ven";
import Decimal from "decimal.js";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string; cmpFrom?: string; cmpTo?: string }>;
};

function fmt(value: string | number): string {
  return fmtVen(value);
}

function pct(amount: string, total: string): string | null {
  const a = parseFloat(amount);
  const t = parseFloat(total);
  if (t === 0 || isNaN(a) || isNaN(t)) return null;
  return ((a / t) * 100).toFixed(1) + "%";
}

function varPct(current: string, compare: string): { text: string; positive: boolean } | null {
  const c = parseFloat(current);
  const p = parseFloat(compare);
  if (isNaN(c) || isNaN(p) || p === 0) return null;
  const delta = ((c - p) / p) * 100;
  return { text: (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%", positive: delta >= 0 };
}

function periodLabel(from?: string, to?: string): string {
  if (from && to) return `${from} – ${to}`;
  if (from) return `Desde ${from}`;
  if (to) return `Hasta ${to}`;
  return "Todo el período";
}

function SectionTable({
  title,
  colorClass,
  rows,
  total,
  compareRows,
  compareTotal,
  showCompare,
  showPct,
}: {
  title: string;
  colorClass: string;
  rows: IncomeStatement["revenues"];
  total: string;
  compareRows?: IncomeStatement["revenues"];
  compareTotal?: string;
  showCompare: boolean;
  showPct: boolean;
}) {
  const colSpan = showCompare ? (showPct ? 5 : 4) : showPct ? 3 : 2;

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className={`border-b px-4 py-3 ${colorClass}`}>
        <h2 className={`font-semibold ${colorClass.includes("green") ? "text-green-800" : "text-red-800"}`}>{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-zinc-500">Cuenta</th>
            <th className="px-4 py-2 text-right font-medium text-zinc-500">Período actual</th>
            {showPct && <th className="px-4 py-2 text-right text-xs font-medium text-zinc-400">% Ing.</th>}
            {showCompare && (
              <>
                <th className="px-4 py-2 text-right font-medium text-zinc-400">Período anterior</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-zinc-400">Var. %</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-3 text-center text-zinc-400">Sin movimientos</td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const cmpRow = compareRows?.find((r) => r.id === row.id);
              const v = showCompare && cmpRow ? varPct(row.balance, cmpRow.balance) : null;
              return (
                <tr key={row.id} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
                  <td className="px-4 py-2 text-zinc-600">
                    <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                    {row.name}
                  </td>
                  <td className="tabular-nums px-4 py-2 text-right font-mono">{fmt(row.balance)}</td>
                  {showPct && (
                    <td className="tabular-nums px-4 py-2 text-right font-mono text-xs text-zinc-400">
                      {pct(row.balance, total) ?? "—"}
                    </td>
                  )}
                  {showCompare && (
                    <>
                      <td className="tabular-nums px-4 py-2 text-right font-mono text-zinc-400">
                        {cmpRow ? fmt(cmpRow.balance) : "—"}
                      </td>
                      <td className={`tabular-nums px-4 py-2 text-right font-mono text-xs ${v ? (v.positive ? "text-green-600" : "text-red-600") : "text-zinc-400"}`}>
                        {v ? v.text : "—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot>
          <tr className={`border-t ${colorClass}`}>
            <td className={`px-4 py-2 font-semibold ${colorClass.includes("green") ? "text-green-800" : "text-red-800"}`}>
              Total {title}
            </td>
            <td className={`tabular-nums px-4 py-2 text-right font-mono font-semibold ${colorClass.includes("green") ? "text-green-800" : "text-red-800"}`}>
              {fmt(total)}
            </td>
            {showPct && (
              <td className={`tabular-nums px-4 py-2 text-right font-mono text-xs font-semibold ${colorClass.includes("green") ? "text-green-700" : "text-red-700"}`}>
                100%
              </td>
            )}
            {showCompare && (
              <>
                <td className="tabular-nums px-4 py-2 text-right font-mono text-zinc-500">
                  {compareTotal ? fmt(compareTotal) : "—"}
                </td>
                <td className={`tabular-nums px-4 py-2 text-right font-mono text-xs ${(() => { const v = compareTotal ? varPct(total, compareTotal) : null; return v ? (v.positive ? "text-green-600" : "text-red-600") : "text-zinc-400"; })()}`}>
                  {(() => { const v = compareTotal ? varPct(total, compareTotal) : null; return v ? v.text : "—"; })()}
                </td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function IncomeStatementPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { from, to, cmpFrom, cmpTo } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Sin rango → redirige al año fiscal corriente para alinear con Balance General (hallazgo #6/#7)
  if (!from && !to) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const today = now.toISOString().split("T")[0];
    redirect(`/company/${companyId}/reports/income-statement?from=${year}-01-01&to=${today}`);
  }

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to + "T23:59:59") : undefined;
  const compareDateFrom = cmpFrom ? new Date(cmpFrom) : undefined;
  const compareDateTo = cmpTo ? new Date(cmpTo + "T23:59:59") : undefined;

  const result = await getIncomeStatementAction(companyId, dateFrom, dateTo, compareDateFrom, compareDateTo);

  if (!result.success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Estado de Resultados</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{result.error}</div>
      </div>
    );
  }

  const { current, compare } = result.data;
  const showCompare = !!compare;
  const netDec = new Decimal(current.netIncome);
  const revTotalDec = new Decimal(current.totalRevenues);
  const isProfit = netDec.gte(0);
  const margin = revTotalDec.gt(0) ? netDec.div(revTotalDec).mul(100).toFixed(1) : null;
  const showPct = revTotalDec.gt(0);
  const islrProyectado = isProfit && netDec.gt(0) ? netDec.mul("0.34").toFixed(2) : null;

  const netVariation = compare ? varPct(current.netIncome, compare.netIncome) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/company/${companyId}/reports`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Reportes
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Estado de Resultados</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {showCompare
              ? `${periodLabel(from, to)} vs. ${periodLabel(cmpFrom, cmpTo)}`
              : periodLabel(from, to)}
          </p>
        </div>
        <ExportFinancialPDFButton companyId={companyId} report="income-statement" />
      </div>

      {/* Filtro */}
      <IncomeStatementFilter
        defaultFrom={from}
        defaultTo={to}
        defaultCmpFrom={cmpFrom}
        defaultCmpTo={cmpTo}
      />

      <div className="mx-auto max-w-4xl space-y-6">
        {/* Ingresos */}
        <SectionTable
          title="Ingresos"
          colorClass="bg-green-50"
          rows={current.revenues}
          total={current.totalRevenues}
          compareRows={compare?.revenues}
          compareTotal={compare?.totalRevenues}
          showCompare={showCompare}
          showPct={showPct}
        />

        {/* Gastos */}
        <SectionTable
          title="Gastos"
          colorClass="bg-red-50"
          rows={current.expenses}
          total={current.totalExpenses}
          compareRows={compare?.expenses}
          compareTotal={compare?.totalExpenses}
          showCompare={showCompare}
          showPct={showPct}
        />

        {/* Resultado neto */}
        <div className={`rounded-lg border-2 p-4 ${isProfit ? "border-green-400 bg-green-50" : "border-red-400 bg-red-50"}`}>
          <div className="flex items-center justify-between">
            <div>
              <span className={`text-lg font-bold ${isProfit ? "text-green-800" : "text-red-800"}`}>
                {isProfit ? "Utilidad del Período" : "Pérdida del Período"}
              </span>
              {margin !== null && (
                <p className={`mt-1 text-xs ${isProfit ? "text-green-600" : "text-red-600"}`}>
                  Margen neto: {isProfit ? "+" : ""}{margin}% sobre ingresos
                </p>
              )}
            </div>
            <div className="text-right">
              <span className={`tabular-nums font-mono text-xl font-bold ${isProfit ? "text-green-700" : "text-red-700"}`}>
                {fmt(current.netIncome)} Bs.
              </span>
              {showCompare && compare && (
                <div className="mt-1 space-x-2 text-xs">
                  <span className="text-zinc-500">vs. {fmt(compare.netIncome)} Bs.</span>
                  {netVariation && (
                    <span className={netVariation.positive ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
                      {netVariation.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ISLR proyectado */}
        {islrProyectado !== null && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">ISLR Proyectado (informativo)</p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-zinc-600">Estimado a tasa corporativa ~34% (Ley ISLR Venezuela)</p>
              <span className="tabular-nums font-mono font-semibold text-zinc-800">{fmt(islrProyectado)} Bs.</span>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Valor indicativo. El cálculo definitivo depende de la renta neta fiscal ajustada por ISLR.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
