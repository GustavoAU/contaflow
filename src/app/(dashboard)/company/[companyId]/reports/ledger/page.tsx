// src/app/(dashboard)/company/[companyId]/reports/ledger/page.tsx
import { getLedgerAction, getCompanyHeaderAction } from "@/modules/accounting/actions/report.actions";
import { DateRangeFilter } from "@/components/reports/DateRangeFilter";
import { LedgerExportButton } from "@/components/reports/LedgerExportButton";
import { LedgerPDFExportButton } from "@/components/reports/LedgerPDFExportButton";
import { LedgerAccountBlock } from "@/components/reports/LedgerAccountBlock";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

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
            <LedgerAccountBlock
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
