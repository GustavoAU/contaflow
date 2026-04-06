"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateFiscalConfigAction } from "../actions/fiscal-close.actions";

type EquityAccount = {
  id: string;
  code: string;
  name: string;
};

type Props = {
  companyId: string;
  equityAccounts: EquityAccount[];
  currentResultAccountId: string | null;
  currentRetainedEarningsAccountId: string | null;
};

export function FiscalConfigForm({
  companyId,
  equityAccounts,
  currentResultAccountId,
  currentRetainedEarningsAccountId,
}: Props) {
  const [resultAccountId, setResultAccountId] = useState(currentResultAccountId ?? "");
  const [retainedEarningsAccountId, setRetainedEarningsAccountId] = useState(
    currentRetainedEarningsAccountId ?? ""
  );
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!resultAccountId || !retainedEarningsAccountId) {
      toast.error("Selecciona ambas cuentas antes de guardar.");
      return;
    }
    startTransition(async () => {
      const result = await updateFiscalConfigAction({
        companyId,
        resultAccountId,
        retainedEarningsAccountId,
      });
      if (result.success) {
        toast.success("Configuración contable guardada.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="resultAccount">Cuenta Resultado del Ejercicio</Label>
        <Select value={resultAccountId} onValueChange={setResultAccountId}>
          <SelectTrigger id="resultAccount" className="w-full">
            <SelectValue placeholder="Seleccionar cuenta EQUITY..." />
          </SelectTrigger>
          <SelectContent>
            {equityAccounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.code} — {acc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Cuenta de Patrimonio donde se acumula el resultado neto del ejercicio al cierre.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="retainedEarningsAccount">Cuenta Utilidades Retenidas / Pérdidas Acumuladas</Label>
        <Select value={retainedEarningsAccountId} onValueChange={setRetainedEarningsAccountId}>
          <SelectTrigger id="retainedEarningsAccount" className="w-full">
            <SelectValue placeholder="Seleccionar cuenta EQUITY..." />
          </SelectTrigger>
          <SelectContent>
            {equityAccounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.code} — {acc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Cuenta de Patrimonio donde se transfiere el resultado en el asiento de apropiación (post-AGO).
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando..." : "Guardar configuración"}
      </Button>
    </form>
  );
}
