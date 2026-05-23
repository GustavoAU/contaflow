"use client";
// src/modules/accounting/components/TransactionList.tsx

import { useState, useMemo } from "react";
import Link from "next/link";
import { SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";

type TransactionSummary = {
  id: string;
  number: string;
  date: string | Date;
  description: string;
  type: string;
  totalDebit: string;
  status: string;
};

type Props = {
  companyId: string;
  transactions: TransactionSummary[];
};

const TYPE_LABELS: Record<string, string> = {
  DIARIO:   "Diario",
  APERTURA: "Apertura",
  AJUSTE:   "Ajuste",
  CIERRE:   "Cierre",
};

const STATUS_COLORS: Record<string, "default" | "destructive"> = {
  POSTED: "default",
  VOIDED: "destructive",
};

const ALL_TYPES   = ["DIARIO", "APERTURA", "AJUSTE", "CIERRE"] as const;
const ALL_STATUSES = ["POSTED", "VOIDED"] as const;

export function TransactionList({ companyId, transactions }: Props) {
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter]  = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (typeFilter   && tx.type   !== typeFilter)   return false;
      if (statusFilter && tx.status !== statusFilter) return false;
      if (q && !tx.number.toLowerCase().includes(q) && !tx.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [transactions, search, typeFilter, statusFilter]);

  const hasFilter = search || typeFilter || statusFilter;

  function clearAll() {
    setSearch("");
    setTypeFilter(null);
    setStatusFilter(null);
  }

  return (
    <div className="space-y-3">
      {/* ─── Barra de filtros ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Búsqueda */}
        <div className="relative flex-1 min-w-50 max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por número o descripción…"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              aria-label="Limpiar búsqueda"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Tipo */}
        <div className="flex gap-1 flex-wrap">
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Status */}
        <div className="flex gap-1">
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? s === "VOIDED"
                    ? "border-red-400 bg-red-50 text-red-700"
                    : "border-green-400 bg-green-50 text-green-700"
                  : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
              }`}
            >
              {s === "POSTED" ? "Contabilizado" : "Anulado"}
            </button>
          ))}
        </div>

        {/* Limpiar + contador */}
        <div className="ml-auto flex items-center gap-2">
          {hasFilter && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
            >
              <XIcon className="h-3 w-3" />
              Limpiar
            </button>
          )}
          <span className="text-xs text-zinc-400">
            {filtered.length} de {transactions.length}
          </span>
        </div>
      </div>

      {/* ─── Tabla ────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-white py-12 text-center text-sm text-zinc-400">
          {hasFilter ? "No hay asientos que coincidan con los filtros." : "No hay asientos registrados."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead className="bg-zinc-50">
                <tr className="[&>th]:border-b [&>th]:border-zinc-200">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-zinc-500 whitespace-nowrap">Número</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-zinc-500 whitespace-nowrap">Fecha</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-zinc-500 min-w-50">Descripción</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-zinc-500 whitespace-nowrap">Tipo</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-zinc-500 whitespace-nowrap min-w-44">Débito</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-zinc-500 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => (
                  <tr key={tx.id} className="bg-white hover:bg-zinc-50 [&>td]:border-b [&>td]:border-zinc-100">
                    <td className="px-4 py-3 font-mono font-medium whitespace-nowrap">
                      <Link
                        href={`/company/${companyId}/transactions/${tx.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {tx.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 whitespace-nowrap">
                      {new Date(tx.date).toLocaleDateString("es-VE")}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate">{tx.description}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-zinc-500">{TYPE_LABELS[tx.type] ?? tx.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                      {formatAmount(tx.totalDebit)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={STATUS_COLORS[tx.status] ?? "default"}>
                        {tx.status === "POSTED" ? "Contabilizado" : "Anulado"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
