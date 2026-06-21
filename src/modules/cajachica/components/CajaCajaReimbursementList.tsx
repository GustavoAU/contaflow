"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FileText, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyBadge } from "@/components/ui/MoneyBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  postReimbursementAction,
  voidReimbursementAction,
} from "../actions/cajachica.actions";
import type { ReimbursementSummary } from "../services/CajaCajaReimbursementService";

type Props = {
  companyId: string;
  reimbursements: ReimbursementSummary[];
  isAdmin: boolean;
  onRefresh: () => void;
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Borrador", className: "bg-amber-100 text-amber-700" },
  POSTED: { label: "Contabilizado", className: "bg-green-100 text-green-700" },
  VOIDED: { label: "Anulado", className: "bg-zinc-100 text-zinc-500 line-through" },
};

// ─── Contabilizar (AlertDialog) ─────────────────────────────────────────────────

function PostConfirm({
  companyId,
  reimbursementId,
  onDone,
}: {
  companyId: string;
  reimbursementId: string;
  onDone: () => void;
}) {
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handlePost() {
    setError(null);
    start(async () => {
      const result = await postReimbursementAction({ reimbursementId, companyId });
      if (!result.success) {
        setError(result.error);
      } else {
        setOpen(false);
        onDone();
      }
    });
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="gap-1.5 text-xs" aria-busy={isPending}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Contabilizar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Contabilizar reembolso</AlertDialogTitle>
            <AlertDialogDescription>
              Esto registrará el asiento contable en el Libro Mayor (Dr gastos / Cr caja). Los
              gastos quedarán marcados como reembolsados. Esta acción no es reversible desde la app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p className="text-xs text-red-600" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handlePost();
              }}
              disabled={isPending}
              aria-busy={isPending}
            >
              Contabilizar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Anular (motivo inline) ─────────────────────────────────────────────────────

function VoidConfirm({
  companyId,
  reimbursementId,
  onDone,
}: {
  companyId: string;
  reimbursementId: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleVoid() {
    setError(null);
    start(async () => {
      const result = await voidReimbursementAction({
        reimbursementId,
        companyId,
        voidReason: reason,
      });
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
          placeholder="Ej: Borrador creado por error"
          minLength={3}
          disabled={isPending}
          className="h-8 text-xs"
        />
        <p className="text-xs text-zinc-500">
          Solo se pueden anular reembolsos en borrador; los gastos vuelven a quedar aprobados.
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

// ─── List ───────────────────────────────────────────────────────────────────────

export function CajaCajaReimbursementList({ companyId, reimbursements, isAdmin, onRefresh }: Props) {
  const [voidingId, setVoidingId] = useState<string | null>(null);

  if (reimbursements.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-400">
        No hay reembolsos. Crea uno para contabilizar los gastos aprobados del mes.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {reimbursements.map((r) => {
        const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.DRAFT;
        const isVoided = r.status === "VOIDED";
        return (
          <div
            key={r.id}
            className={`rounded-lg border bg-white p-3 dark:bg-zinc-950 ${
              isVoided ? "opacity-60" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                    {cfg.label}
                  </span>
                  {r.status === "POSTED" && r.transactionId && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      <FileText className="h-3 w-3" aria-hidden />
                      Asiento generado
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {r.reimbursementNumber}
                </p>
                <p className="text-xs text-zinc-500">
                  {r.monthYear} · {r.movementCount} {r.movementCount === 1 ? "gasto" : "gastos"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <MoneyBadge amount={r.totalExpensesVes} currency="VES" />
                </p>
              </div>
            </div>

            {isAdmin && r.status === "DRAFT" && voidingId !== r.id && (
              <div className="mt-2 flex gap-2">
                <PostConfirm
                  companyId={companyId}
                  reimbursementId={r.id}
                  onDone={onRefresh}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setVoidingId(r.id)}
                  className="gap-1.5 text-xs"
                >
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                  Anular
                </Button>
              </div>
            )}

            {isAdmin && voidingId === r.id && (
              <VoidConfirm
                companyId={companyId}
                reimbursementId={r.id}
                onDone={() => {
                  setVoidingId(null);
                  onRefresh();
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
