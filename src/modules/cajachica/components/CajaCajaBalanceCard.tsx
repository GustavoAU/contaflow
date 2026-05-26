"use client";

import type { CajaCajaSummary } from "../services/CajaCajaService";
import { MoneyBadge } from "@/components/ui/MoneyBadge";

type Props = {
  caja: CajaCajaSummary;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  INACTIVE: "Inactiva",
  CLOSED: "Cerrada",
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  INACTIVE: "bg-yellow-100 text-yellow-700",
  CLOSED: "bg-zinc-100 text-zinc-500",
};


export function CajaCajaBalanceCard({ caja }: Props) {
  const percent = caja.percentUsed;
  const barColor = percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-400" : "bg-emerald-500";
  // Solo rojo cuando hubo depósito y se agotó el saldo; sin depósito = neutro
  const availableColor =
    Number(caja.totalDeposited) === 0
      ? "text-zinc-600 dark:text-zinc-400"
      : Number(caja.availableBalance) <= 0
      ? "text-red-600"
      : "text-emerald-600";

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm dark:bg-zinc-950 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{caja.name}</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {caja.accountCode} — {caja.accountName}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[caja.status] ?? "bg-zinc-100 text-zinc-500"}`}
        >
          {STATUS_LABEL[caja.status] ?? caja.status}
        </span>
      </div>

      {/* Balance row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs text-zinc-500">Depositado</p>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <MoneyBadge amount={caja.totalDeposited} currency={caja.currency} />
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Comprometido</p>
          <p className="text-sm font-semibold text-amber-600">
            <MoneyBadge
              amount={(Number(caja.totalPendingMovements) + Number(caja.totalApprovedMovements)).toFixed(2)}
              currency={caja.currency}
            />
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">Disponible</p>
          <p className={`text-sm font-semibold ${availableColor}`}>
            <MoneyBadge amount={caja.availableBalance} currency={caja.currency} />
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-zinc-500">% Utilizado</span>
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{percent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-1.5 rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
