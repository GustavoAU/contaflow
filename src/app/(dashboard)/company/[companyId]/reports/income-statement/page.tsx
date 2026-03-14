// src/app/(dashboard)/company/[companyId]/reports/income-statement/page.tsx
import { getIncomeStatementAction } from "@/modules/accounting/actions/report.actions";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

function formatAmount(value: string): string {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export default async function IncomeStatementPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getIncomeStatementAction(companyId);

  return (
    <div className="space-y-6">
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

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Ingresos */}
          <div className="overflow-hidden rounded-lg border bg-white">
            <div className="border-b bg-green-50 px-4 py-3">
              <h2 className="font-semibold text-green-800">Ingresos</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {result.data.revenues.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-center text-zinc-400">
                      Sin movimientos
                    </td>
                  </tr>
                ) : (
                  result.data.revenues.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="px-4 py-2 text-zinc-600">
                        <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                        {row.name}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatAmount(row.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-green-50">
                  <td className="px-4 py-2 font-semibold text-green-800">Total Ingresos</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-green-800">
                    {formatAmount(result.data.totalRevenues)}
                  </td>
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
              <tbody>
                {result.data.expenses.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-3 text-center text-zinc-400">
                      Sin movimientos
                    </td>
                  </tr>
                ) : (
                  result.data.expenses.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="px-4 py-2 text-zinc-600">
                        <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                        {row.name}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatAmount(row.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t bg-red-50">
                  <td className="px-4 py-2 font-semibold text-red-800">Total Gastos</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-red-800">
                    {formatAmount(result.data.totalExpenses)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Resultado neto */}
          {(() => {
            const net = parseFloat(result.data.netIncome);
            const isProfit = net >= 0;
            return (
              <div
                className={`rounded-lg border-2 p-4 ${isProfit ? "border-green-400 bg-green-50" : "border-red-400 bg-red-50"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-lg font-bold ${isProfit ? "text-green-800" : "text-red-800"}`}
                  >
                    {isProfit ? "✅ Utilidad del Período" : "❌ Pérdida del Período"}
                  </span>
                  <span
                    className={`font-mono text-xl font-bold ${isProfit ? "text-green-700" : "text-red-700"}`}
                  >
                    {formatAmount(result.data.netIncome)}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
