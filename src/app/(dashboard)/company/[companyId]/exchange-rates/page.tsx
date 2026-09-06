// src/app/(dashboard)/company/[companyId]/exchange-rates/page.tsx
//
// Restaurada (2026-09-07): el commit b275652 (19-04-2026) reemplazó esta
// página por el widget del encabezado, que solo auto-fetcha la tasa de HOY
// desde dolarapi.com — no admite fecha manual. Eso dejó sin forma de
// registrar una tasa HISTÓRICA (ej. para backfill de prestaciones, Art. 143
// LOTTT), aunque ExchangeRateForm/upsertExchangeRateAction SÍ lo soportan —
// quedaron sin ningún componente que los montara. El widget se queda para
// el día a día; esta página cubre el caso que el widget no puede.
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import prisma from "@/lib/prisma";
import { listExchangeRatesAction } from "@/modules/exchange-rates/actions/exchange-rate.actions";
import { ExchangeRateForm } from "@/modules/exchange-rates/components/ExchangeRateForm";

type Props = { params: Promise<{ companyId: string }> };

const CURRENCY_LABEL: Record<string, string> = {
  USD: "USD — Dólar",
  EUR: "EUR — Euro",
};

function fmt(value: string) {
  const n = parseFloat(value);
  return isNaN(n)
    ? value
    : new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);
}

export default async function ExchangeRatesPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");

  const result = await listExchangeRatesAction(companyId);
  const rates = result.success ? result.data : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Tasas de Cambio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tipo de cambio oficial BCV — 1 USD/EUR = X Bs. (VES). Para la tasa de hoy, usa el
          widget «BCV» del encabezado; para una fecha pasada (ej. completar un historial), usa
          el formulario de abajo.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExchangeRateForm companyId={companyId} userId={userId} />

        <div className="space-y-3">
          <h2 className="font-semibold">Historial de tasas</h2>
          {rates.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-white p-8 text-center">
              <p className="text-sm text-zinc-400">No hay tasas registradas aún</p>
            </div>
          ) : (
            <div className="max-h-112 overflow-y-auto rounded-lg border bg-white">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-zinc-50 text-xs font-medium text-zinc-500 uppercase">
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
                        {new Date(r.date).toLocaleDateString("es-VE", { timeZone: "UTC" })}
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
