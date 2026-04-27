// src/app/(dashboard)/company/[companyId]/reports/journal/page.tsx
import { getJournalAction } from "@/modules/accounting/actions/report.actions";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import type { JournalTransaction } from "@/modules/accounting/actions/report.actions";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  DIARIO: "Diario",
  APERTURA: "Apertura",
  AJUSTE: "Ajuste",
  CIERRE: "Cierre",
};

function fmt(v: string): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(v));
}

function TransactionBlock({ tx, companyId }: { tx: JournalTransaction; companyId: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Encabezado del asiento */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-zinc-50 px-4 py-2">
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
  const { from, to } = await searchParams;

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to + "T23:59:59") : undefined;

  const result = await getJournalAction(companyId, dateFrom, dateTo);
  const transactions = result.success ? result.data : [];

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
        <h1 className="text-2xl font-bold tracking-tight">Libro Diario</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Registro cronológico de todos los asientos contabilizados
        </p>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </div>

      {!result.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {result.error}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          No hay asientos contabilizados
          {from || to ? " en el período seleccionado" : ""}.
        </div>
      ) : (
        <div className="space-y-4">
          {transactions.map((tx) => (
            <TransactionBlock key={tx.id} tx={tx} companyId={companyId} />
          ))}
        </div>
      )}
    </div>
  );
}
