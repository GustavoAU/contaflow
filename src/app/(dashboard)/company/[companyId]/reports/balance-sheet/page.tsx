// src/app/(dashboard)/company/[companyId]/reports/balance-sheet/page.tsx
import { getBalanceSheetAction } from "@/modules/accounting/actions/report.actions";
import { ExportFinancialPDFButton } from "@/modules/accounting/components/ExportFinancialPDFButton";
import { BalanceSheetFilter } from "@/components/reports/BalanceSheetFilter";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ to?: string }>;
};

function fmtAccounting(value: string): { display: string; negative: boolean } {
  const num = parseFloat(value);
  if (isNaN(num)) return { display: value, negative: false };
  const abs = new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));
  if (num < 0) return { display: `(${abs})`, negative: true };
  return { display: abs, negative: false };
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
            rows.map((row, i) => {
              const { display, negative } = fmtAccounting(row.balance);
              return (
                <tr key={row.id} className={`border-b last:border-0 ${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
                  <td className="px-4 py-2 text-zinc-600">
                    <span className="mr-2 font-mono text-xs text-zinc-400">{row.code === "—" ? "" : row.code}</span>
                    {row.name}
                  </td>
                  <td className={`tabular-nums px-4 py-2 text-right font-mono ${negative ? "text-red-600" : ""}`}>
                    {display}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot>
          {(() => {
            const { display, negative } = fmtAccounting(total);
            return (
              <tr className={`border-t ${colorClass}`}>
                <td className="px-4 py-2 font-semibold">Total {title}</td>
                <td className={`tabular-nums px-4 py-2 text-right font-mono font-semibold ${negative ? "text-red-600" : ""}`}>
                  {display} Bs.
                </td>
              </tr>
            );
          })()}
        </tfoot>
      </table>
    </div>
  );
}

export default async function BalanceSheetPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { to } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Sin fecha de corte → redirige a hoy para que la URL siempre refleje el período real (hallazgo #6)
  if (!to) {
    const today = new Date().toISOString().split("T")[0];
    redirect(`/company/${companyId}/reports/balance-sheet?to=${today}`);
  }

  const dateTo = new Date(to + "T23:59:59");
  const result = await getBalanceSheetAction(companyId, dateTo);

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
          <h1 className="text-2xl font-bold tracking-tight">Balance General</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {`Corte al ${to} — Resultado del ejercicio ${new Date(to).getUTCFullYear()}`}
          </p>
        </div>
        <ExportFinancialPDFButton companyId={companyId} report="balance-sheet" />
      </div>

      <BalanceSheetFilter defaultTo={to} />

      {!result.success ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Activos Corrientes */}
          <Section
            title="Activos Corrientes"
            rows={result.data.currentAssets}
            total={result.data.totalCurrentAssets}
            colorClass="bg-blue-50 text-blue-800"
          />

          {/* Activos No Corrientes */}
          <Section
            title="Activos No Corrientes"
            rows={result.data.nonCurrentAssets}
            total={result.data.totalNonCurrentAssets}
            colorClass="bg-sky-50 text-sky-800"
          />

          {/* Pasivos Corrientes */}
          <Section
            title="Pasivos Corrientes"
            rows={result.data.currentLiabilities}
            total={result.data.totalCurrentLiabilities}
            colorClass="bg-orange-50 text-orange-800"
          />

          {/* Pasivos No Corrientes */}
          <Section
            title="Pasivos No Corrientes"
            rows={result.data.nonCurrentLiabilities}
            total={result.data.totalNonCurrentLiabilities}
            colorClass="bg-amber-50 text-amber-800"
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
            <p className={`font-bold ${result.data.isBalanced ? "text-green-800" : "text-red-800"}`}>
              {result.data.isBalanced ? "✅ Balance cuadrado" : "⚠️ Balance descuadrado"}
            </p>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <div className="text-center">
                <p className="text-xs text-zinc-500">Activos</p>
                <p className={`tabular-nums font-mono font-bold ${fmtAccounting(result.data.totalAssets).negative ? "text-red-600" : ""}`}>
                  {fmtAccounting(result.data.totalAssets).display} Bs.
                </p>
              </div>
              <span className="text-zinc-400 font-bold">=</span>
              <div className="text-center">
                <p className="text-xs text-zinc-500">Pasivos + Patrimonio</p>
                <p className={`tabular-nums font-mono font-bold ${fmtAccounting(result.data.totalLiabilitiesAndEquity).negative ? "text-red-600" : ""}`}>
                  {fmtAccounting(result.data.totalLiabilitiesAndEquity).display} Bs.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
