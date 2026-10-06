"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMovementAction } from "../actions/cajachica.actions";
import { todayLocalISO } from "@/lib/today";
import { MoneyInput } from "@/components/ui/money-input";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import {
  isSelectableAccountId,
  selectableAccounts,
  type AccountWithType,
} from "@/lib/account-search";

// SPEC-012: títulos Y cuentas de movimiento; el combobox solo deja elegir las de movimiento.
type Account = AccountWithType;

type Props = {
  companyId: string;
  cajaCajaId: string;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
};

export function CajaCajaMovementForm({
  companyId,
  cajaCajaId,
  accounts,
  onSuccess,
  onCancel,
}: Props) {
  const [date, setDate] = useState(todayLocalISO());
  const [concept, setConcept] = useState("");
  const [description, setDescription] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [expenseMissing, setExpenseMissing] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [supportingDocumentId, setSupportingDocumentId] = useState("");
  const [providerRif, setProviderRif] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Defensa en cliente: un gasto de caja chica solo puede imputarse a una cuenta de Gasto
  // (el server valida el tipo de cuenta también).
  // `expenseAccounts` incluye los títulos de Gasto (encabezados no elegibles); el aviso y el
  // `disabled` cuentan SOLO cuentas de movimiento (RN-19).
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");
  const hasExpenseAccount = selectableAccounts(expenseAccounts).length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // El combobox es un <input type=text>: ya no existe el `required` nativo del <select>.
    if (!isSelectableAccountId(expenseAccounts, expenseAccountId)) {
      setExpenseMissing(true);
      setError("Selecciona la cuenta de Gasto a la que se imputa el movimiento.");
      return;
    }

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
        providerRif: providerRif || undefined,
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
          <Label htmlFor="movement-date" className="text-xs">
            Fecha *
          </Label>
          <Input
            id="movement-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="movement-currency" className="text-xs">
            Moneda *
          </Label>
          <select
            id="movement-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm"
            disabled={isPending}
          >
            <option value="VES">VES</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-concept" className="text-xs">
            Concepto *
          </Label>
          <Input
            id="movement-concept"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            placeholder="Café, taxi, suministros..."
            maxLength={255}
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-expense-account" className="text-xs">
            Cuenta de Gasto *
          </Label>
          <AccountCombobox
            id="movement-expense-account"
            accounts={expenseAccounts}
            value={expenseAccountId}
            onChange={(next) => {
              setExpenseAccountId(next);
              setExpenseMissing(false);
            }}
            aria-invalid={expenseMissing ? true : undefined}
            disabled={isPending}
          />
          {!hasExpenseAccount && (
            <p className="text-xs text-amber-600">
              No hay cuentas de tipo Gasto. Crea una cuenta de Gasto en el Plan de Cuentas antes de
              registrar movimientos.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="movement-amount" className="text-xs">
            Monto {currency} *
          </Label>
          <MoneyInput
            id="movement-amount"
            value={amount}
            onValueChange={setAmount}
            placeholder="0,00"
            required
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="movement-support" className="text-xs">
            N° Soporte <span className="text-red-500">*</span>
          </Label>
          <Input
            id="movement-support"
            value={supportingDocumentId}
            onChange={(e) => setSupportingDocumentId(e.target.value)}
            placeholder="Factura, recibo, ticket..."
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-provider-rif" className="text-xs">
            RIF del proveedor (opcional)
          </Label>
          <Input
            id="movement-provider-rif"
            value={providerRif}
            onChange={(e) => setProviderRif(e.target.value)}
            placeholder="J-12345678-9"
            maxLength={20}
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-description" className="text-xs">
            Descripción (opcional)
          </Label>
          <Input
            id="movement-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalles adicionales..."
            maxLength={500}
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="movement-notes" className="text-xs">
            Notas internas (opcional)
          </Label>
          <Input
            id="movement-notes"
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

      <div className="flex gap-2 border-t pt-1">
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
