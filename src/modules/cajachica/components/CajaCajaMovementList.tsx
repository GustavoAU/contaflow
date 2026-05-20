"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import { approveMovementAction, voidMovementAction } from "../actions/cajachica.actions";
import type { MovementSummary } from "../services/CajaCajaMovementService";

type Props = {
  companyId: string;
  movements: MovementSummary[];
  isAdmin: boolean;
  onRefresh: () => void;
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendiente", className: "bg-amber-100 text-amber-700" },
  APPROVED: { label: "Aprobado", className: "bg-blue-100 text-blue-700" },
  REIMBURSED: { label: "Reembolsado", className: "bg-green-100 text-green-700" },
  VOIDED: { label: "Anulado", className: "bg-zinc-100 text-zinc-500 line-through" },
};


function VoidConfirm({
  companyId,
  movementId,
  onDone,
}: {
  companyId: string;
  movementId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleVoid() {
    start(async () => {
      const result = await voidMovementAction({ movementId, companyId, voidReason: reason });
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
          placeholder="Ej: Error en el monto"
          minLength={3}
          disabled={isPending}
          className="h-8 text-xs"
        />
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

export function CajaCajaMovementList({ companyId, movements, isAdmin, onRefresh }: Props) {
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function handleApprove(movementId: string) {
    setApproveError(null);
    setApprovingId(movementId);
    start(async () => {
      const result = await approveMovementAction({ movementId, companyId });
      setApprovingId(null);
      if (!result.success) setApproveError(result.error);
      else onRefresh();
    });
  }

  if (movements.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No hay movimientos registrados.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {approveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {approveError}
        </div>
      )}
      {movements.map((m) => {
        const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.PENDING;
        return (
          <div
            key={m.id}
            className="rounded-lg border bg-white p-3 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-zinc-500">{m.voucherNumber}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                    {cfg.label}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {m.concept}
                </p>
                <p className="text-xs text-zinc-500">
                  {m.date} · {m.expenseAccountCode} {m.expenseAccountName}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <MoneyBadge amount={m.amount} currency={m.currency} />
                </p>
              </div>
            </div>

            {/* Actions */}
            {isAdmin && m.status === "PENDING" && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleApprove(m.id)}
                  disabled={isPending && approvingId === m.id}
                  aria-busy={isPending && approvingId === m.id}
                  className="gap-1.5 text-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Aprobar
                </Button>
                {voidingId !== m.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setVoidingId(m.id)}
                    className="gap-1.5 text-xs"
                  >
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                    Anular
                  </Button>
                )}
              </div>
            )}

            {voidingId === m.id && (
              <VoidConfirm
                companyId={companyId}
                movementId={m.id}
                onDone={() => { setVoidingId(null); onRefresh(); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
