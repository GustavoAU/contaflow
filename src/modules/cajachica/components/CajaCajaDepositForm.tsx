"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDepositAction } from "../actions/cajachica.actions";

type Account = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  cajaCajaId: string;
  /** Cuenta contable de la propia Caja Chica — se excluye de las opciones de origen. */
  cajaAccountId: string;
  currency: string;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
};

export function CajaCajaDepositForm({
  companyId,
  cajaCajaId,
  cajaAccountId,
  currency,
  accounts,
  onSuccess,
  onCancel,
}: Props) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [supportingDocumentId, setSupportingDocumentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // La cuenta origen no puede ser la misma cuenta de la caja (el servidor también lo valida).
  const sourceOptions = accounts.filter((a) => a.id !== cajaAccountId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createDepositAction({
        companyId,
        cajaCajaId,
        sourceAccountId,
        date,
        amount,
        description,
        supportingDocumentId: supportingDocumentId || undefined,
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha *</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={isPending} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Monto {currency} *</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Cuenta origen (Banco/Caja general) *</Label>
          <select
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            required
            disabled={isPending}
          >
            <option value="">Seleccionar cuenta...</option>
            {sourceOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-500">
            De dónde sale el efectivo que reposa la caja. Asiento: Dr Caja Chica / Cr esta cuenta.
          </p>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Descripción *</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Reposición de fondo fijo..."
            maxLength={500}
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">N° Soporte (opcional)</Label>
          <Input
            value={supportingDocumentId}
            onChange={(e) => setSupportingDocumentId(e.target.value)}
            placeholder="Transferencia, comprobante..."
            disabled={isPending}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t">
        <Button type="submit" size="sm" disabled={isPending} aria-busy={isPending}>
          Registrar depósito
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
