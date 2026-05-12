// src/modules/income-distribution/components/VoidDistributionModal.tsx
"use client";

import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IncomeDistributionSummary } from "../services/IncomeDistributionService";
import { voidDistributionAction } from "../actions/income-distribution.actions";

type Props = {
  companyId: string;
  distribution: IncomeDistributionSummary;
  onClose: () => void;
  onSuccess: () => void;
};

export function VoidDistributionModal({ companyId, distribution, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await voidDistributionAction({
        distributionId: distribution.id,
        companyId,
        voidReason: reason,
      });
      if (!result.success) {
        setError(result.error);
      } else {
        onSuccess();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-white shadow-lg dark:bg-zinc-950">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Anular distribución</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Borrador {distribution.referenceNumber ?? "sin número"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="void-reason" className="text-xs">Motivo de anulación *</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Error en los porcentajes ingresados"
              minLength={3}
              maxLength={500}
              required
              disabled={isPending}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={isPending || reason.trim().length < 3}
              aria-busy={isPending}
            >
              Confirmar anulación
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
