"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMovementAction } from "../actions/cajachica.actions";

type Account = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  cajaCajaId: string;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
};

export function CajaCajaMovementForm({ companyId, cajaCajaId, accounts, onSuccess, onCancel }: Props) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [concept, setConcept] = useState("");
  const [description, setDescription] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [supportingDocumentId, setSupportingDocumentId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const needsSupport = currency === "VES" && Number(amount) > 500_000;

  // Defensa en cliente: un gasto de caja chica solo puede imputarse a una cuenta de Gasto
  // (el server valida el tipo de cuenta también).
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createMovementAction({
        companyId,
        cajaCajaId,
        date,
        concept,
        description: description || undefined,
        expenseAccountId,
        amount,
        currency,
        supportingDocumentId: supportingDocumentId || undefined,
        notes: notes || undefined,
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
          <Label className="text-xs">Moneda *</Label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            disabled={isPending}
          >
            <option value="VES">VES</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Concepto *</Label>
          <Input
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Café, taxi, suministros..."
            maxLength={255}
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-expense-account" className="text-xs">Cuenta de Gasto *</Label>
          <select
            id="movement-expense-account"
            value={expenseAccountId}
            onChange={(e) => setExpenseAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            required
            disabled={isPending || expenseAccounts.length === 0}
          >
            <option value="">Seleccionar cuenta...</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          {expenseAccounts.length === 0 && (
            <p className="text-xs text-amber-600">
              No hay cuentas de tipo Gasto. Crea una cuenta de Gasto en el Plan de Cuentas antes de
              registrar movimientos.
            </p>
          )}
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
        <div className="space-y-1.5">
          <Label className="text-xs">
            N° Soporte {needsSupport ? <span className="text-red-500">*</span> : "(opcional)"}
          </Label>
          <Input
            value={supportingDocumentId}
            onChange={(e) => setSupportingDocumentId(e.target.value)}
            placeholder="Factura, recibo..."
            required={needsSupport}
            disabled={isPending}
          />
          {needsSupport && (
            <p className="text-xs text-amber-600">Obligatorio para gastos &gt; VES 500,000</p>
          )}
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Descripción (opcional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles adicionales..."
            maxLength={500}
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Notas internas (opcional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Uso interno..."
            maxLength={500}
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
          Registrar gasto
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
