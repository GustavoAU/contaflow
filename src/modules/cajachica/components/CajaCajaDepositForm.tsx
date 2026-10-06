"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDepositAction } from "../actions/cajachica.actions";
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
  const [date, setDate] = useState(todayLocalISO());
  const uid = useId();
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [sourceMissing, setSourceMissing] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [supportingDocumentId, setSupportingDocumentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // HAL-001: la cuenta origen debe ser de tipo ASSET (banco/caja general) y distinta
  // de la cuenta de la caja. El servidor también lo valida (assertAccountOfType ASSET).
  // `sourceOptions` incluye los títulos (encabezados no elegibles); el combobox decide por isPostable.
  const sourceOptions = accounts.filter((a) => a.type === "ASSET" && a.id !== cajaAccountId);
  // RN-19: el campo solo tiene sentido si queda alguna cuenta de movimiento que elegir.
  const hasSource = selectableAccounts(sourceOptions).length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // El combobox es un <input type=text>: ya no existe el `required` nativo del <select>.
    if (!isSelectableAccountId(sourceOptions, sourceAccountId)) {
      setSourceMissing(true);
      setError(
        hasSource
          ? "Selecciona la cuenta origen (Banco/Caja general) del depósito."
          : "No hay una cuenta de Activo disponible como origen. Crea una en el Plan de Cuentas."
      );
      return;
    }

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
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={isPending}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Monto {currency} *</Label>
          <MoneyInput
            value={amount}
            onValueChange={setAmount}
            placeholder="0,00"
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor={`${uid}-source`} className="text-xs">
            Cuenta origen (Banco/Caja general) *
          </Label>
          <AccountCombobox
            id={`${uid}-source`}
            accounts={sourceOptions}
            value={sourceAccountId}
            onChange={(next) => {
              setSourceAccountId(next);
              setSourceMissing(false);
            }}
            aria-invalid={sourceMissing ? true : undefined}
            disabled={isPending}
          />
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

      <div className="flex gap-2 border-t pt-1">
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
