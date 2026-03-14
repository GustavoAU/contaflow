// src/app/(dashboard)/company/[companyId]/reports/balance-sheet/page.tsx
import { getBalanceSheetAction } from "@/modules/accounting/actions/report.actions";
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

function Section({
  title,
  rows,
  total,
  colorClass,
}: {
  title: string;
  rows: { id: string; code: string; name: string; balance: string }[];
  total: string;
  colorClass: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className={`border-b px-4 py-3 ${colorClass}`}>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="px-4 py-3 text-center text-zinc-400">
                Sin movimientos
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-2 text-zinc-600">
                  <span className="mr-2 font-mono text-xs text-zinc-400">{row.code}</span>
                  {row.name}
                </td>
                <td className="px-4 py-2 text-right font-mono">{formatAmount(row.balance)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className={`border-t ${colorClass}`}>
            <td className="px-4 py-2 font-semibold">Total {title}</td>
            <td className="px-4 py-2 text-right font-mono font-semibold">{formatAmount(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function BalanceSheetPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getBalanceSheetAction(companyId);

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
        <h1 className="text-2xl font-bold tracking-tight">Balance General</h1>
        <p className="text-muted-foreground mt-1 text-sm">Estado de Situación Financiera</p>
      </div>

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Activos */}
          <Section
            title="Activos"
            rows={result.data.assets}
            total={result.data.totalAssets}
            colorClass="bg-blue-50 text-blue-800"
          />

          {/* Pasivos */}
          <Section
            title="Pasivos"
            rows={result.data.liabilities}
            total={result.data.totalLiabilities}
            colorClass="bg-orange-50 text-orange-800"
          />

          {/* Patrimonio */}
          <Section
            title="Patrimonio"
            rows={result.data.equity}
            total={result.data.totalEquity}
            colorClass="bg-purple-50 text-purple-800"
          />

          {/* Verificación de cuadre */}
          <div
            className={`rounded-lg border-2 p-4 ${result.data.isBalanced ? "border-green-400 bg-green-50" : "border-red-400 bg-red-50"}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p
                  className={`font-bold ${result.data.isBalanced ? "text-green-800" : "text-red-800"}`}
                >
                  {result.data.isBalanced ? "✅ Balance cuadrado" : "⚠️ Balance descuadrado"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Pasivos + Patrimonio = {formatAmount(result.data.totalLiabilitiesAndEquity)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Total Activos</p>
                <p className="font-mono text-lg font-bold">
                  {formatAmount(result.data.totalAssets)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
