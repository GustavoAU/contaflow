// src/app/(dashboard)/company/[companyId]/reports/ledger/page.tsx
import { getLedgerAction, getCompanyHeaderAction } from "@/modules/accounting/actions/report.actions";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import { LedgerExportButton } from "@/components/reports/LedgerExportButton";
import { LedgerPDFExportButton } from "@/components/reports/LedgerPDFExportButton";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import type { LedgerAccount } from "@/modules/accounting/actions/report.actions";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

function fmt(v: string): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(v));
}

function AccountBlock({ account, companyId, hasDateFilter }: {
  account: LedgerAccount;
  companyId: string;
  hasDateFilter: boolean;
}) {
  const showOpening = hasDateFilter && account.openingBalance !== "0.00";

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Header de la cuenta */}
      <div className="flex items-center justify-between border-b bg-zinc-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold text-blue-600">{account.code}</span>
          <span className="font-semibold">{account.name}</span>
          <span className="text-xs text-zinc-500">{TYPE_LABELS[account.type]}</span>
        </div>
        <div className="flex gap-6 text-sm">
          <span className="text-zinc-500">
            Débitos (Bs.):{" "}
            <span className="font-mono font-semibold tabular-nums text-zinc-800">
              {fmt(account.totalDebit)}
            </span>
          </span>
          <span className="text-zinc-500">
            Créditos (Bs.):{" "}
            <span className="font-mono font-semibold tabular-nums text-zinc-800">
              {fmt(account.totalCredit)}
            </span>
          </span>
          <span className="text-zinc-500">
            Saldo (Bs.):{" "}
            <span className="font-mono font-bold tabular-nums text-blue-600">
              {fmt(account.balance)}
            </span>
          </span>
        </div>
      </div>

      {/* Movimientos */}
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr className="text-zinc-500">
            <th className="px-4 py-2 text-left font-medium">Fecha</th>
            <th className="px-4 py-2 text-left font-medium">Número</th>
            <th className="px-4 py-2 text-left font-medium">Descripción</th>
            <th className="px-4 py-2 text-right font-medium">Débito (Bs.)</th>
            <th className="px-4 py-2 text-right font-medium">Crédito (Bs.)</th>
            <th className="px-4 py-2 text-right font-medium">Saldo (Bs.)</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {/* Fila saldo anterior — solo cuando hay filtro de fechas */}
          {showOpening && (
            <tr className="bg-amber-50">
              <td className="px-4 py-2 text-zinc-400 italic text-xs" colSpan={3}>
                Saldo anterior al período
              </td>
              <td className="px-4 py-2" />
              <td className="px-4 py-2" />
              <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold text-amber-700">
                {fmt(account.openingBalance)}
              </td>
            </tr>
          )}
          {account.entries.map((entry, i) => (
            <tr key={i} className={`${i % 2 === 1 ? "bg-zinc-50/60" : ""} hover:bg-zinc-100/60`}>
              <td className="px-4 py-2 text-zinc-600">
                {new Date(entry.date).toLocaleDateString("es-VE")}
              </td>
              <td className="px-4 py-2 font-mono text-xs">
                <Link
                  href={`/company/${companyId}/transactions/${entry.transactionId}`}
                  className="text-blue-600 hover:underline"
                >
                  {entry.number}
                </Link>
              </td>
              <td className="max-w-xs truncate px-4 py-2">{entry.description}</td>
              <td className="tabular-nums px-4 py-2 text-right font-mono">
                {entry.debit ? fmt(entry.debit) : "—"}
              </td>
              <td className="tabular-nums px-4 py-2 text-right font-mono">
                {entry.credit ? fmt(entry.credit) : "—"}
              </td>
              <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold">
                {fmt(entry.balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function LedgerPage({ params, searchParams }: Props) {
  const { companyId } = await params;
  const { from, to } = await searchParams;

  const dateFrom = from ? new Date(from) : undefined;
  const dateTo = to ? new Date(to + "T23:59:59") : undefined;

  const [ledgerResult, companyResult] = await Promise.all([
    getLedgerAction(companyId, dateFrom, dateTo),
    getCompanyHeaderAction(companyId),
  ]);

  const accounts = ledgerResult.success ? ledgerResult.data : [];
  const company = companyResult.success ? companyResult.data : null;
  const periodLabel = from || to ? `${from ?? "inicio"} al ${to ?? "hoy"}` : "todos los períodos";
  const hasDateFilter = !!(from || to);

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
          <h1 className="text-2xl font-bold tracking-tight">Libro Mayor</h1>
          {company && (
            <p className="text-sm font-medium text-zinc-700">
              {company.name}
              {company.rif && (
                <span className="ml-2 text-zinc-400">RIF: {company.rif}</span>
              )}
            </p>
          )}
          <p className="text-muted-foreground mt-0.5 text-sm">
            Movimientos por cuenta — {periodLabel}
          </p>
        </div>
        {accounts.length > 0 && (
          <div className="flex items-center gap-2">
            <LedgerExportButton accounts={accounts} period={periodLabel} />
            <LedgerPDFExportButton
              companyId={companyId}
              dateFrom={from}
              dateTo={to}
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <DateRangeFilter defaultFrom={from} defaultTo={to} />
      </div>

      {!ledgerResult.success && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {ledgerResult.error}
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          No hay movimientos registrados
          {from || to ? " en el período seleccionado" : ""}.
        </div>
      ) : (
        <div className="space-y-8">
          {accounts.map((account) => (
            <AccountBlock
              key={account.id}
              account={account}
              companyId={companyId}
              hasDateFilter={hasDateFilter}
            />
          ))}
        </div>
      )}

      {/* Certificación — visible en pantalla al pie */}
      {accounts.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
          <p className="mb-6 text-center text-xs text-zinc-400">
            Certifico que la presente información es fiel reflejo de los libros contables de la empresa,
            de conformidad con los Principios de Contabilidad de Aceptación General en Venezuela (VEN-NIF).
          </p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="mb-6 border-b border-zinc-400" />
              <p className="font-semibold text-zinc-700">Representante Legal</p>
              <p className="text-zinc-400">Nombre: _________________________________</p>
              <p className="text-zinc-400">C.I.: ____________________________________</p>
            </div>
            <div>
              <div className="mb-6 border-b border-zinc-400" />
              <p className="font-semibold text-zinc-700">Contador Público Colegiado (C.P.C.)</p>
              <p className="text-zinc-400">Nombre: _________________________________</p>
              <p className="text-zinc-400">C.P.C. No.: ________ RIF: ________________</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
