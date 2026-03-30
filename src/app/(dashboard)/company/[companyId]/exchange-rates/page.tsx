// src/app/(dashboard)/company/[companyId]/exchange-rates/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { listExchangeRatesAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import { ExchangeRateForm } from "@/modules/exchange-rates/components/ExchangeRateForm";

type Props = {
  params: Promise<{ companyId: string }>;
};

const CURRENCY_LABEL: Record<string, string> = {
  USD: "🇺🇸 USD",
  EUR: "🇪🇺 EUR",
};

function fmt(value: string) {
  const n = parseFloat(value);
  return isNaN(n)
    ? value
    : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(
        n,
      );
}

export default async function ExchangeRatesPage({ params }: Props) {
  const { companyId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await listExchangeRatesAction(companyId);
  const rates = result.success ? result.data : [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Tasas BCV</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tipo de cambio oficial BCV — 1 USD/EUR = X Bs.D (VES)
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Formulario */}
        <ExchangeRateForm companyId={companyId} userId={user.id} />

        {/* Historial */}
        <div className="space-y-3">
          <h2 className="font-semibold">Historial de tasas</h2>
          {rates.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-white p-8 text-center">
              <p className="text-sm text-zinc-400">No hay tasas registradas aún</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead className="border-b bg-zinc-50 text-xs font-medium text-zinc-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-left">Moneda</th>
                    <th className="px-4 py-3 text-right">Tasa (VES)</th>
                    <th className="px-4 py-3 text-left">Fuente</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rates.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                        {new Date(r.date).toLocaleDateString("es-VE")}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {CURRENCY_LABEL[r.currency] ?? r.currency}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmt(r.rate)}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
