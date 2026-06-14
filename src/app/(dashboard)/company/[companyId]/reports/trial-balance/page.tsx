// src/app/(dashboard)/company/[companyId]/reports/trial-balance/page.tsx
import { getTrialBalanceAction } from "@/modules/accounting/actions/report.actions";
import { ExportFinancialPDFButton } from "@/modules/accounting/components/ExportFinancialPDFButton";
import { TrialBalanceFilter } from "@/components/reports/TrialBalanceFilter";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { fmtVen } from "@/lib/fmt-ven";
import Decimal from "decimal.js";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Contra-activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

const TYPE_COLORS: Record<string, string> = {
  ASSET: "text-blue-600",
  CONTRA_ASSET: "text-blue-400",
  LIABILITY: "text-red-600",
  EQUITY: "text-purple-600",
  REVENUE: "text-green-600",
  EXPENSE: "text-orange-600",
};

function fmt(v: string | number | Decimal): string {
  return fmtVen(v instanceof Decimal ? v.toFixed(2) : v);
}

export default async function TrialBalancePage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { from, to } = await searchParams;

  // Hallazgo #4: misma guarda que Ledger — sin fechas el Balance de Comprobación
  // mostraría acumulados históricos mezclando todos los períodos.
  if (!from && !to) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const today = now.toISOString().split("T")[0];
    redirect(`/company/${companyId}/reports/trial-balance?from=${year}-01-01&to=${today}`);
  }

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to + "T23:59:59") : undefined;
  const result = await getTrialBalanceAction(companyId, dateFrom, dateTo);

  if (!result.success) redirect("/dashboard");

  const rows = result.data;

  function periodLabel(): string {
    if (from && to) return `${from} – ${to}`;
    if (from) return `Desde ${from}`;
    if (to) return `Hasta ${to}`;
    return "Acumulado (todo el período)";
  }

  // Agrupar por tipo en orden contable
  const TYPE_ORDER = ["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
  const groups = TYPE_ORDER
    .map((type) => ({ type, rows: rows.filter((r) => r.type === type) }))
    .filter((g) => g.rows.length > 0);

  // Totales generales
  const grandTotalDebit = rows.reduce((acc, r) => acc.plus(new Decimal(r.totalDebit.toString())), new Decimal(0));
  const grandTotalCredit = rows.reduce((acc, r) => acc.plus(new Decimal(r.totalCredit.toString())), new Decimal(0));
  const grandBalance = grandTotalDebit.minus(grandTotalCredit);
  const isBalanced = grandBalance.abs().lt(new Decimal("0.01"));

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/company/${companyId}/reports`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Reportes
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Balance de Comprobación</h1>
          <p className="text-muted-foreground mt-1 text-sm">{periodLabel()}</p>
        </div>
        <ExportFinancialPDFButton companyId={companyId} report="trial-balance" />
      </div>

      <TrialBalanceFilter defaultFrom={from} defaultTo={to} />

      {rows.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No hay movimientos registrados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Código</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Cuenta</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Débitos (Bs.)</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Créditos (Bs.)</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Saldo (Bs.)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {groups.map(({ type, rows: groupRows }) => {
                const groupDebit = groupRows.reduce((a, r) => a.plus(new Decimal(r.totalDebit.toString())), new Decimal(0));
                const groupCredit = groupRows.reduce((a, r) => a.plus(new Decimal(r.totalCredit.toString())), new Decimal(0));
                const groupBalance = groupDebit.minus(groupCredit);
                const color = TYPE_COLORS[type];
                return (
                  <>
                    {/* Filas del grupo */}
                    {groupRows.map((row, i) => (
                      <tr key={row.id} className={`${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
                        <td className="px-4 py-3 font-mono font-medium text-blue-600">{row.code}</td>
                        <td className="px-4 py-3 font-medium">{row.name}</td>
                        <td className={`px-4 py-3 text-xs font-semibold ${color}`}>
                          {TYPE_LABELS[row.type]}
                        </td>
                        <td className="tabular-nums px-4 py-3 text-right font-mono">{fmt(row.totalDebit)}</td>
                        <td className="tabular-nums px-4 py-3 text-right font-mono">{fmt(row.totalCredit)}</td>
                        <td className="tabular-nums px-4 py-3 text-right font-mono font-semibold">{fmt(row.balance)}</td>
                      </tr>
                    ))}
                    {/* Subtotal del grupo */}
                    <tr className={`border-t bg-zinc-100/80`}>
                      <td colSpan={3} className={`px-4 py-2 text-xs font-bold ${color}`}>
                        Subtotal {TYPE_LABELS[type]}
                      </td>
                      <td className="tabular-nums px-4 py-2 text-right font-mono text-xs font-bold text-zinc-700">
                        {fmt(groupDebit)}
                      </td>
                      <td className="tabular-nums px-4 py-2 text-right font-mono text-xs font-bold text-zinc-700">
                        {fmt(groupCredit)}
                      </td>
                      <td className={`tabular-nums px-4 py-2 text-right font-mono text-xs font-bold ${color}`}>
                        {fmt(groupBalance)}
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
            {/* Totales generales */}
            <tfoot className="border-t-2 bg-zinc-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-bold">
                  TOTALES
                </td>
                <td className="tabular-nums px-4 py-3 text-right font-mono font-bold">
                  {fmt(grandTotalDebit)}
                </td>
                <td className="tabular-nums px-4 py-3 text-right font-mono font-bold">
                  {fmt(grandTotalCredit)}
                </td>
                <td
                  className={`tabular-nums px-4 py-3 text-right font-mono font-bold ${
                    isBalanced ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {fmt(grandBalance)}
                </td>
              </tr>
              <tr>
                <td colSpan={6} className={`px-4 py-2 text-right text-xs ${isBalanced ? "bg-green-50" : "bg-red-50"}`}>
                  {isBalanced ? (
                    <span className="font-semibold text-green-600">&#10003; Balanceado — Débitos = Créditos</span>
                  ) : (
                    <span className="font-semibold text-red-600">
                      &#9888; Desbalanceado — diferencia: {fmt(grandBalance.abs())} Bs.
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
