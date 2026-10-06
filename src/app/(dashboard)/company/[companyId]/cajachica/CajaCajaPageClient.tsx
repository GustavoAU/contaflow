"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import {
  isSelectableAccountId,
  selectableAccounts,
  type AccountWithType,
} from "@/lib/account-search";
import { CajaCajaList } from "@/modules/cajachica/components/CajaCajaList";
import {
  listCajasCajasAction,
  createCajaCajaAction,
} from "@/modules/cajachica/actions/cajachica.actions";
import type { CajaCajaSummary } from "@/modules/cajachica/services/CajaCajaService";

// SPEC-012: títulos Y cuentas de movimiento; el combobox solo deja elegir las de movimiento.
type Account = AccountWithType;
type Employee = { id: string; name: string; status: string };

type Props = {
  companyId: string;
  accounts: Account[];
  employees: Employee[];
  isAdmin: boolean;
};

function CreateCajaForm({
  companyId,
  accounts,
  employees,
  onSuccess,
  onCancel,
}: {
  companyId: string;
  accounts: Account[];
  employees: Employee[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountMissing, setAccountMissing] = useState(false);
  const [custodianId, setCustodianId] = useState("");
  const [maxBalance, setMaxBalance] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  // Defensa en cliente: la cuenta de la caja debe ser de tipo Activo (el server valida también).
  // `assetAccounts` incluye los títulos de Activo (se muestran como encabezados); el aviso y el
  // `disabled` cuentan SOLO cuentas de movimiento (RN-19).
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const hasAssetAccount = selectableAccounts(assetAccounts).length > 0;

  // Preferir empleados activos; si no hay, listar todos para no bloquear la creación.
  const activeEmployees = employees.filter((e) => e.status === "ACTIVE");
  const custodianOptions = activeEmployees.length > 0 ? activeEmployees : employees;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // El combobox es un <input type=text>: ya no existe el `required` nativo del <select>.
    if (!isSelectableAccountId(assetAccounts, accountId)) {
      setAccountMissing(true);
      setError("Selecciona la cuenta contable (Activo) de la caja chica.");
      return;
    }
    start(async () => {
      const result = await createCajaCajaAction({
        companyId,
        name,
        accountId,
        custodianId,
        currency,
        maxBalance,
      });
      if (!result.success) setError(result.error);
      else onSuccess();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="caja-name" className="text-xs">
            Nombre *
          </Label>
          <Input
            id="caja-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Caja Chica Operativa"
            maxLength={255}
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="caja-account" className="text-xs">
            Cuenta contable (Activo) *
          </Label>
          <AccountCombobox
            id="caja-account"
            accounts={assetAccounts}
            value={accountId}
            onChange={(next) => {
              setAccountId(next);
              setAccountMissing(false);
            }}
            aria-invalid={accountMissing ? true : undefined}
            disabled={isPending}
          />
          {!hasAssetAccount && (
            <p className="text-xs text-amber-600">
              No hay cuentas de tipo Activo. Crea una cuenta de Activo en el Plan de Cuentas antes
              de registrar una caja chica.
            </p>
          )}
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="caja-custodian" className="text-xs">
            Custodio responsable *
          </Label>
          <select
            id="caja-custodian"
            value={custodianId}
            onChange={(e) => setCustodianId(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm"
            required
            disabled={isPending || custodianOptions.length === 0}
          >
            <option value="">Seleccionar empleado...</option>
            {custodianOptions.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
          {custodianOptions.length === 0 && (
            <p className="text-xs text-amber-600">
              No hay empleados registrados. Registra al menos un empleado para asignarlo como
              custodio.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="caja-currency" className="text-xs">
            Moneda
          </Label>
          <select
            id="caja-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm"
            disabled={isPending}
          >
            <option value="VES">VES</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="caja-max" className="text-xs">
            Saldo máximo
          </Label>
          <MoneyInput
            id="caja-max"
            value={maxBalance}
            onValueChange={setMaxBalance}
            placeholder="50.000.000,00"
            required
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
          Crear Caja Chica
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function CajaCajaPageClient({ companyId, accounts, employees, isAdmin }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [cajas, setCajas] = useState<CajaCajaSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();

  const load = useCallback(() => {
    startLoad(async () => {
      const result = await listCajasCajasAction(companyId);
      if (result.success) {
        setCajas(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    });
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Caja Chica</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Fondos fijos para gastos menores. Cumple Providencia 0071 SENIAT.
          </p>
        </div>
        {isAdmin && !showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nueva caja
          </Button>
        )}
      </div>

      {/* Create form */}
      {isAdmin && showCreate && (
        <div className="rounded-xl border bg-white p-5 shadow-sm dark:bg-zinc-950">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nueva Caja Chica
          </h2>
          <CreateCajaForm
            companyId={companyId}
            accounts={accounts}
            employees={employees}
            onSuccess={() => {
              setShowCreate(false);
              load();
            }}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">Cargando...</div>
      ) : (
        <CajaCajaList
          companyId={companyId}
          cajas={cajas}
          accounts={accounts}
          employees={employees}
          isAdmin={isAdmin}
          onRefresh={load}
        />
      )}
    </div>
  );
}
