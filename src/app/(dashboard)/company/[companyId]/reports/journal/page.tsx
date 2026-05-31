// src/app/(dashboard)/company/[companyId]/reports/journal/page.tsx
import { redirect } from "next/navigation";
import { getJournalAction } from "@/modules/accounting/actions/report.actions";
import { getPeriodsAction } from "@/modules/accounting/actions/period.actions";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import { JournalExportButton } from "@/components/reports/JournalExportButton";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import type { JournalTransaction } from "@/modules/accounting/actions/report.actions";
import { fmtVen } from "@/lib/fmt-ven";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  DIARIO: "Diario",
  APERTURA: "Apertura",
  AJUSTE: "Ajuste",
  CIERRE: "Cierre",
};

function fmt(v: string): string {
  return fmtVen(v);
}

function TransactionBlock({ tx, companyId, folio }: { tx: JournalTransaction; companyId: string; folio?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Encabezado del asiento */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-zinc-50 px-4 py-2">
        {folio !== undefined && (
          <span className="font-mono text-xs text-zinc-400 w-12" title="Número de folio">
            f.{String(folio).padStart(3, "0")}
          </span>
        )}
        <span className="w-24 text-sm text-zinc-500">
          {new Date(tx.date).toLocaleDateString("es-VE")}
        </span>
        <Link
          href={`/company/${companyId}/transactions/${tx.id}`}
          className="font-mono text-sm font-semibold text-blue-700 hover:underline"
        >
          {tx.number}
        </Link>
        <span className="flex-1 text-sm text-zinc-700">{tx.description}</span>
        {tx.reference && (
          <span className="font-mono text-xs text-zinc-400">{tx.reference}</span>
        )}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
          {TYPE_LABELS[tx.type] ?? tx.type}
        </span>
      </div>

      {/* Partidas */}
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr className="text-xs text-zinc-400">
            <th className="w-20 px-4 py-1.5 text-left font-normal">Código</th>
            <th className="px-4 py-1.5 text-left font-normal">Cuenta</th>
            <th className="w-40 px-4 py-1.5 text-right font-normal">Débito (Bs.)</th>
            <th className="w-40 px-4 py-1.5 text-right font-normal">Crédito (Bs.)</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tx.lines.map((line, i) => (
            <tr key={i} className="hover:bg-zinc-50/60">
              <td className="px-4 py-2 font-mono text-xs text-zinc-500">{line.accountCode}</td>
              <td className={`px-4 py-2 ${line.credit ? "pl-10" : ""}`}>{line.accountName}</td>
              <td className="tabular-nums px-4 py-2 text-right font-mono">
                {line.debit ? fmt(line.debit) : "—"}
              </td>
              <td className="tabular-nums px-4 py-2 text-right font-mono">
                {line.credit ? fmt(line.credit) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-zinc-50 text-sm font-semibold">
            <td colSpan={2} className="px-4 py-2 text-right text-zinc-500">
              Sumas iguales
            </td>
            <td className="tabular-nums px-4 py-2 text-right font-mono">{fmt(tx.totalDebit)}</td>
            <td className="tabular-nums px-4 py-2 text-right font-mono">{fmt(tx.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function JournalPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { from, to, q } = await searchParams;

  // Error 1 SENIAT-dictamen: sin filtro el Libro Diario muestra TODOS los períodos
  // incluyendo facturas de períodos anteriores (ej. TESA-007 enero 2026 = f.001 falso).
  // Si no hay parámetros de fecha, redirigir al período ABIERTO automáticamente.
  // try/catch: si getPeriodsAction falla (Neon cold start), continuar sin redirigir
  // en lugar de crashear con 404.
  if (!from && !to) {
    try {
      const periodsForRedirect = await getPeriodsAction(companyId);
      if (periodsForRedirect.success) {
        const open = periodsForRedirect.data.find((p) => p.status === "OPEN");
        if (open) {
          const mm = String(open.month).padStart(2, "0");
          const lastDay = new Date(open.year, open.month, 0).getDate();
          const dd = String(lastDay).padStart(2, "0");
          redirect(`/company/${companyId}/reports/journal?from=${open.year}-${mm}-01&to=${open.year}-${mm}-${dd}`);
        }
      }
    } catch (redirectErr) {
      // re-throw solo si es un redirect de Next.js — otros errores se ignoran
      // para que la página se muestre vacía en vez de crashear
      if (
        redirectErr &&
        typeof redirectErr === "object" &&
        "digest" in redirectErr &&
        String((redirectErr as { digest: string }).digest).startsWith("NEXT_REDIRECT")
      ) {
        throw redirectErr;
      }
    }
  }

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to + "T23:59:59") : undefined;

  const [result, periodsResult] = await Promise.all([
    getJournalAction(companyId, dateFrom, dateTo, q),
    getPeriodsAction(companyId),
  ]);
  const transactions = result.success ? result.data : [];
  const periods = periodsResult.success
    ? periodsResult.data.map((p) => ({ year: p.year, month: p.month, status: p.status }))
    : [];

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
          <h1 className="text-2xl font-bold tracking-tight">Libro Diario</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Registro cronológico de todos los asientos contabilizados
            {from || to ? ` — ${from ?? "inicio"} al ${to ?? "hoy"}` : ""}
            {q ? ` · Búsqueda: "${q}"` : ""}
          </p>
        </div>
        {transactions.length > 0 && (
          <JournalExportButton
            transactions={transactions}
            period={from || to ? `${from ?? "inicio"} al ${to ?? "hoy"}` : "todos los períodos"}
          />
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <DateRangeFilter defaultFrom={from} defaultTo={to} periods={periods} />
      </div>

      {/* Búsqueda por texto */}
      <form className="flex flex-wrap items-center gap-2">
        {from && <input type="hidden" name="from" value={from} />}
        {to && <input type="hidden" name="to" value={to} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por descripción, número o referencia…"
          className="w-72 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Buscar
        </button>
        {q && (
          <a
            href={`?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`}
            className="text-sm text-zinc-500 underline hover:text-zinc-800"
          >
            Limpiar búsqueda
          </a>
        )}
      </form>

      {!result.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          No hay asientos contabilizados
          {q ? ` que coincidan con "${q}"` : from || to ? " en el período seleccionado" : ""}.
        </div>
      ) : (
        <div className="space-y-4">
          {transactions.map((tx, idx) => (
            <TransactionBlock key={tx.id} tx={tx} companyId={companyId} folio={idx + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
