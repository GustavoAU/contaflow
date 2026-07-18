// src/modules/accounting/components/VoidTransactionButton.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { voidTransactionAction } from "@/modules/accounting/actions/transaction.actions";

type Props = {
  transactionId: string;
  transactionNumber: string;
  userId: string;
};

const MIN_REASON = 10;

/**
 * Botón + diálogo para anular un asiento contabilizado (crea un asiento espejo con
 * montos invertidos; el original queda VOIDED, nunca se borra — R "NEVER DELETE → VOID").
 * Solo se monta cuando el asiento está POSTED y el usuario es ADMIN/OWNER (gate en el
 * page + en la action). El motivo es obligatorio (mín. 10 caracteres, igual que el schema).
 */
export function VoidTransactionButton({ transactionId, transactionNumber, userId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const reasonTooShort = reason.trim().length < MIN_REASON;

  function handleVoid() {
    startTransition(async () => {
      const result = await voidTransactionAction({ transactionId, userId, reason: reason.trim() });
      if (result.success) {
        toast.success(`Asiento ${transactionNumber} anulado. Se creó el asiento de reversión ${result.data.number}.`);
        setOpen(false);
        setReason("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4" />
        Anular
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular asiento {transactionNumber}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              La anulación no borra el asiento: genera un asiento de reversión con los montos
              invertidos y marca este como <span className="font-medium">Anulado</span>. Esta
              acción no se puede deshacer.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="void-reason" className="text-xs">
                Motivo de la anulación * <span className="text-zinc-400">(mín. {MIN_REASON} caracteres)</span>
              </Label>
              <Input
                id="void-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej: Cuenta equivocada en la partida de débito"
                minLength={MIN_REASON}
                maxLength={500}
                disabled={isPending}
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={isPending || reasonTooShort}
              aria-busy={isPending}
            >
              {isPending ? "Anulando..." : "Confirmar anulación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
