// src/app/(dashboard)/company/[companyId]/reports/trial-balance/page.tsx
import { getTrialBalanceAction } from "@/modules/accounting/actions/report.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

const TYPE_COLORS: Record<string, string> = {
  ASSET: "text-blue-600",
  LIABILITY: "text-red-600",
  EQUITY: "text-purple-600",
  REVENUE: "text-green-600",
  EXPENSE: "text-orange-600",
};

export default async function TrialBalancePage({ params }: Props) {
  const { companyId } = await params;
  const result = await getTrialBalanceAction(companyId);

  if (!result.success) redirect("/dashboard");

  const rows = result.data;

  // Totales generales
  const grandTotalDebit = rows.reduce((acc, r) => acc + Number(r.totalDebit), 0);
  const grandTotalCredit = rows.reduce((acc, r) => acc + Number(r.totalCredit), 0);
  const grandBalance = grandTotalDebit - grandTotalCredit;
  const isBalanced = Math.abs(grandBalance) < 0.01;

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div>
        <Link
          href={`/company/${companyId}/reports`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Reportes
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Balance de Comprobación</h1>
        <p className="text-muted-foreground mt-1 text-sm">Sumas y saldos de todas las cuentas</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No hay movimientos registrados.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Código</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Cuenta</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Débitos</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Créditos</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono font-medium text-blue-600">{row.code}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className={`px-4 py-3 text-xs font-semibold ${TYPE_COLORS[row.type]}`}>
                    {TYPE_LABELS[row.type]}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{row.totalDebit}</td>
                  <td className="px-4 py-3 text-right font-mono">{row.totalCredit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{row.balance}</td>
                </tr>
              ))}
            </tbody>
            {/* Totales */}
            <tfoot className="border-t-2 bg-zinc-50">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-bold">
                  TOTALES
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {grandTotalDebit.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">
                  {grandTotalCredit.toFixed(2)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono font-bold ${
                    isBalanced ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {grandBalance.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td colSpan={6} className="px-4 py-2 text-right text-xs">
                  {isBalanced ? (
                    <span className="font-semibold text-green-600">✓ Balanceado</span>
                  ) : (
                    <span className="font-semibold text-red-600">⚠ Diferencia detectada</span>
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
