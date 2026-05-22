"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { fmtDate } from "@/lib/format";
import type { LedgerAccount } from "@/modules/accounting/actions/report.actions";
import { fmtVen } from "@/lib/fmt-ven";

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Activo",
  CONTRA_ASSET: "Activo Contra", // cuentas reguladoras: Dep. Acumulada, Provisión CxC
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
};

function fmt(v: string): string {
  return fmtVen(v);
}

interface LedgerAccountBlockProps {
  account: LedgerAccount;
  companyId: string;
  hasDateFilter: boolean;
  defaultExpanded?: boolean;
}

export function LedgerAccountBlock({
  account,
  companyId,
  hasDateFilter,
  defaultExpanded,
}: LedgerAccountBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const showOpening = hasDateFilter && account.openingBalance !== "0.00";

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* Header de la cuenta — clickable para colapsar/expandir */}
      <div
        className="flex cursor-pointer items-center justify-between border-b bg-zinc-50 px-4 py-3 select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Colapsar" : "Expandir"} cuenta ${account.code} ${account.name}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          )}
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-blue-600">{account.code}</span>
            <span className="font-semibold">{account.name}</span>
            <span className="text-xs text-zinc-500">{TYPE_LABELS[account.type]}</span>
          </div>
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

      {/* Movimientos — solo visibles cuando está expandido */}
      {expanded && (
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
                  {fmtDate(entry.date)}
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
          {account.entries.length > 0 && (
            <tfoot className="border-t bg-zinc-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-xs text-zinc-400">
                  {account.entries.length} movimiento{account.entries.length !== 1 ? "s" : ""}
                </td>
                <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold text-zinc-700">
                  {fmt(account.totalDebit)}
                </td>
                <td className="tabular-nums px-4 py-2 text-right font-mono font-semibold text-zinc-700">
                  {fmt(account.totalCredit)}
                </td>
                <td className="tabular-nums px-4 py-2 text-right font-mono font-bold text-blue-600">
                  {fmt(account.balance)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}
