// src/app/(dashboard)/company/[companyId]/reports/income-statement/page.tsx
import { getIncomeStatementAction } from "@/modules/accounting/actions/report.actions";
import { ExportFinancialPDFButton } from "@/modules/accounting/components/ExportFinancialPDFButton";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

function fmt(value: string | number): string {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return "0,00";
  return new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

function pct(amount: string, total: string): string | null {
  const a = parseFloat(amount);
  const t = parseFloat(total);
  if (t === 0 || isNaN(a) || isNaN(t)) return null;
  return ((a / t) * 100).toFixed(1) + "%";
}

export default async function IncomeStatementPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getIncomeStatementAction(companyId);

  if (!result.success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Estado de Resultados</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      </div>
    );
  }

  const { revenues, expenses, totalRevenues, totalExpenses, netIncome } = result.data;
  const net = parseFloat(netIncome);
  const revTotal = parseFloat(totalRevenues);
  const isProfit = net >= 0;
  const margin = revTotal > 0 ? ((net / revTotal) * 100).toFixed(1) : null;
  const showPct = revTotal > 0;
  // ISLR proyectado: tarifa corporativa Venezuela ~34% sobre la utilidad
  const islrProyectado = isProfit && net > 0 ? net * 0.34 : null;

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
          <p className="text-muted-foreground mt-1 text-sm">Ingresos y gastos del período</p>
        </div>
        <ExportFinancialPDFButton companyId={companyId} report="income-statement" />
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Ingresos */}
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-green-50 px-4 py-3">
            <h2 className="font-semibold text-green-800">Ingresos</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Cuenta</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Monto (Bs.)</th>
                {showPct && <th className="px-4 py-2 text-right font-medium text-zinc-400 text-xs">% Ingresos</th>}
              </tr>
            </thead>
            <tbody>
              {revenues.length === 0 ? (
                <tr>
                  <td colSpan={showPct ? 3 : 2} className="px-4 py-3 text-center text-zinc-400">
                    Sin movimientos
                  </td>
                </tr>
              ) : (
                revenues.map((row, i) => (
                  <tr key={row.id} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
                    <td className="px-4 py-2 text-zinc-600">
                      <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                      {row.name}
                    </td>
                    <td className="tabular-nums px-4 py-2 text-right font-mono">{fmt(row.balance)}</td>
                    {showPct && (
                      <td className="tabular-nums px-4 py-2 text-right font-mono text-xs text-zinc-400">
                        {pct(row.balance, totalRevenues) ?? "—"}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t bg-green-50">
                <td className="px-4 py-2 font-semibold text-green-800">Total Ingresos</td>
                <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold text-green-800">
                  {fmt(totalRevenues)}
                </td>
                {showPct && <td className="tabular-nums px-4 py-2 text-right font-mono text-xs font-semibold text-green-700">100%</td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Gastos */}
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="border-b bg-red-50 px-4 py-3">
            <h2 className="font-semibold text-red-800">Gastos</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Cuenta</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Monto (Bs.)</th>
                {showPct && <th className="px-4 py-2 text-right font-medium text-zinc-400 text-xs">% Ingresos</th>}
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={showPct ? 3 : 2} className="px-4 py-3 text-center text-zinc-400">
                    Sin movimientos
                  </td>
                </tr>
              ) : (
                expenses.map((row, i) => (
                  <tr key={row.id} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
                    <td className="px-4 py-2 text-zinc-600">
                      <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                      {row.name}
                    </td>
                    <td className="tabular-nums px-4 py-2 text-right font-mono">{fmt(row.balance)}</td>
                    {showPct && (
                      <td className="tabular-nums px-4 py-2 text-right font-mono text-xs text-zinc-400">
                        {pct(row.balance, totalRevenues) ?? "—"}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t bg-red-50">
                <td className="px-4 py-2 font-semibold text-red-800">Total Gastos</td>
                <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold text-red-800">
                  {fmt(totalExpenses)}
                </td>
                {showPct && (
                  <td className="tabular-nums px-4 py-2 text-right font-mono text-xs font-semibold text-red-700">
                    {pct(totalExpenses, totalRevenues) ?? "—"}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

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
            <span className={`tabular-nums font-mono text-xl font-bold ${isProfit ? "text-green-700" : "text-red-700"}`}>
              {fmt(netIncome)} Bs.
            </span>
          </div>
        </div>

        {/* ISLR proyectado — informativo, no contable (ítem 33) */}
        {islrProyectado !== null && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              ISLR Proyectado (informativo)
            </p>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-zinc-600">
                Estimado a tasa corporativa ~34% (Ley ISLR Venezuela)
              </p>
              <span className="tabular-nums font-mono font-semibold text-zinc-800">
                {fmt(islrProyectado)} Bs.
              </span>
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
