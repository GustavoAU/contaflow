"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createReimbursementAction } from "../actions/cajachica.actions";

type Props = {
  companyId: string;
  cajaCajaId: string;
  onSuccess: () => void;
  onCancel: () => void;
};

export function CajaCajaReimbursementForm({
  companyId,
  cajaCajaId,
  onSuccess,
  onCancel,
}: Props) {
  // <input type="month"> devuelve "YYYY-MM" nativamente — justo el formato del schema.
  const [monthYear, setMonthYear] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createReimbursementAction({
        companyId,
        cajaCajaId,
        monthYear,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        onSuccess();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="reimb-month" className="text-xs">
          Mes a reembolsar *
        </Label>
        <Input
          id="reimb-month"
          type="month"
          value={monthYear}
          onChange={(e) => setMonthYear(e.target.value)}
          required
          disabled={isPending}
        />
        <p className="text-xs text-zinc-500">
          Agrupa todos los gastos aprobados del mes en un reembolso (borrador). Luego deberás
          contabilizarlo para que impacte el Libro Mayor.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t">
        <Button type="submit" size="sm" disabled={isPending} aria-busy={isPending}>
          Crear reembolso
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
