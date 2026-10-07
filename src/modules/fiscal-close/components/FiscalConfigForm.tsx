"use client";

// SPEC-012 B2: las dos cuentas de Patrimonio son `AccountCombobox`. `equityAccounts` trae títulos Y cuentas
// de movimiento (los títulos solo se ven como encabezados). Q4: si una cuenta guardada ya no es elegible
// (título o cuenta eliminada), `SavedAccountsAlert` la lista desde el primer render y el guardado queda
// bloqueado (botón deshabilitado + `submit` que retorna) hasta reemplazarla.

import { useId, useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { SavedAccountsAlert } from "@/components/accounting/SavedAccountsAlert";
import {
  isSelectableAccountId,
  unselectableSavedAccounts,
  type AccountOption,
} from "@/lib/account-search";
import { updateFiscalConfigAction } from "../actions/fiscal-close.actions";

// `isPostable` es OBLIGATORIO: sin él el combobox trataría todas las cuentas como títulos.
type EquityAccount = AccountOption;

type Props = {
  companyId: string;
  equityAccounts: EquityAccount[];
  currentResultAccountId: string | null;
  currentRetainedEarningsAccountId: string | null;
};

// Los mismos rótulos de las etiquetas visibles: la alerta nombra a cada campo como lo ve el usuario.
const RESULT_LABEL = "Cuenta Resultado del Ejercicio";
const RETAINED_LABEL = "Cuenta Utilidades Retenidas / Pérdidas Acumuladas";

export function FiscalConfigForm({
  companyId,
  equityAccounts,
  currentResultAccountId,
  currentRetainedEarningsAccountId,
}: Props) {
  const alertId = useId();
  const [resultAccountId, setResultAccountId] = useState(currentResultAccountId ?? "");
  const [retainedEarningsAccountId, setRetainedEarningsAccountId] = useState(
    currentRetainedEarningsAccountId ?? ""
  );
  const [isPending, startTransition] = useTransition();

  // Q4: con los valores ACTUALES (no solo los iniciales) y contra la lista de Patrimonio.
  const problems = unselectableSavedAccounts([
    {
      key: "resultAccountId",
      label: RESULT_LABEL,
      value: resultAccountId,
      accounts: equityAccounts,
    },
    {
      key: "retainedEarningsAccountId",
      label: RETAINED_LABEL,
      value: retainedEarningsAccountId,
      accounts: equityAccounts,
    },
  ]);
  const blocked = problems.length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Defensa en profundidad (Q4): el botón ya está deshabilitado, pero un `submit` (Enter) no debe guardar.
    if (blocked) return;
    // L-2: se revalida contra la lista VIGENTE; un título o una cuenta ausente no cuentan como elegidas.
    if (
      !isSelectableAccountId(equityAccounts, resultAccountId) ||
      !isSelectableAccountId(equityAccounts, retainedEarningsAccountId)
    ) {
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
      {/* Q4: cuentas guardadas que ya no se pueden usar; bloquean el guardado hasta corregirlas. */}
      <SavedAccountsAlert id={alertId} problems={problems} />

      <div className="space-y-2">
        <Label htmlFor="resultAccount">{RESULT_LABEL}</Label>
        <AccountCombobox
          id="resultAccount"
          accounts={equityAccounts}
          value={resultAccountId}
          onChange={setResultAccountId}
          aria-describedby="resultAccount-hint"
        />
        <p id="resultAccount-hint" className="text-muted-foreground text-xs">
          Cuenta de Patrimonio donde se acumula el resultado neto del ejercicio al cierre.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="retainedEarningsAccount">{RETAINED_LABEL}</Label>
        <AccountCombobox
          id="retainedEarningsAccount"
          accounts={equityAccounts}
          value={retainedEarningsAccountId}
          onChange={setRetainedEarningsAccountId}
          aria-describedby="retainedEarningsAccount-hint"
        />
        <p id="retainedEarningsAccount-hint" className="text-muted-foreground text-xs">
          Cuenta de Patrimonio donde se transfiere el resultado en el asiento de apropiación
          (post-AGO).
        </p>
      </div>

      <Button
        type="submit"
        disabled={isPending || blocked}
        aria-busy={isPending}
        aria-describedby={blocked ? alertId : undefined}
      >
        {isPending && <Loader2Icon className="animate-spin" />}
        {isPending ? "Guardando..." : "Guardar configuración"}
      </Button>
    </form>
  );
}
