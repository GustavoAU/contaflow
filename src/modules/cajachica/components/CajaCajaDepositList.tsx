"use client";

import { useState, useTransition } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import { voidDepositAction } from "../actions/cajachica.actions";
import type { DepositSummary } from "../services/CajaCajaDepositService";

type Props = {
  companyId: string;
  deposits: DepositSummary[];
  currency: string;
  isAdmin: boolean;
  onRefresh: () => void;
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  POSTED: { label: "Contabilizado", className: "bg-green-100 text-green-700" },
  VOIDED: { label: "Anulado", className: "bg-zinc-100 text-zinc-500 line-through" },
};

function VoidConfirm({
  companyId,
  depositId,
  onDone,
}: {
  companyId: string;
  depositId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleVoid() {
    start(async () => {
      const result = await voidDepositAction({ depositId, companyId, voidReason: reason });
      if (!result.success) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <div className="space-y-1">
        <Label className="text-xs">Motivo de anulación *</Label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: Depósito duplicado"
          minLength={3}
          disabled={isPending}
          className="h-8 text-xs"
        />
        <p className="text-xs text-zinc-500">
          Se registrará un asiento de reversión (contrapartida); el original queda anulado.
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending || reason.trim().length < 3}
          onClick={handleVoid}
          aria-busy={isPending}
        >
          Confirmar
        </Button>
        <Button size="sm" variant="outline" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function CajaCajaDepositList({ companyId, deposits, currency, isAdmin, onRefresh }: Props) {
  const [voidingId, setVoidingId] = useState<string | null>(null);

  if (deposits.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No hay depósitos registrados.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {deposits.map((d) => {
        const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.POSTED;
        return (
          <div key={d.id} className="rounded-lg border bg-white p-3 dark:bg-zinc-950">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                  {cfg.label}
                </span>
                <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {d.description}
                </p>
                <p className="text-xs text-zinc-500">{d.date}</p>
                {d.status === "VOIDED" && d.voidReason && (
                  <p className="mt-0.5 text-xs text-red-500">Anulado: {d.voidReason}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <MoneyBadge amount={d.amount} currency={currency} />
                </p>
              </div>
            </div>

            {isAdmin && d.status === "POSTED" && voidingId !== d.id && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVoidingId(d.id)}
                  className="gap-1.5 text-xs"
                >
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                  Anular
                </Button>
              </div>
            )}

            {voidingId === d.id && (
              <VoidConfirm
                companyId={companyId}
                depositId={d.id}
                onDone={() => { setVoidingId(null); onRefresh(); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
