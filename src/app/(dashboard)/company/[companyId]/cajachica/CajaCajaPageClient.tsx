"use client";

import { useState, useCallback, useTransition, useEffect } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CajaCajaList } from "@/modules/cajachica/components/CajaCajaList";
import {
  listCajasCajasAction,
  createCajaCajaAction,
} from "@/modules/cajachica/actions/cajachica.actions";
import type { CajaCajaSummary } from "@/modules/cajachica/services/CajaCajaService";

type Account = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  accounts: Account[];
  isAdmin: boolean;
};

function CreateCajaForm({
  companyId,
  accounts,
  onSuccess,
  onCancel,
}: {
  companyId: string;
  accounts: Account[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [maxBalance, setMaxBalance] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await createCajaCajaAction({
        companyId,
        name,
        accountId,
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
          <Label className="text-xs">Nombre *</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Caja Chica Operativa"
            maxLength={255}
            required
            disabled={isPending}
          />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs">Cuenta contable *</Label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            required
            disabled={isPending}
          >
            <option value="">Seleccionar cuenta...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Moneda</Label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            disabled={isPending}
          >
            <option value="VES">VES</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Saldo máximo</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={maxBalance}
            onChange={(e) => setMaxBalance(e.target.value)}
            placeholder="50000000"
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

export function CajaCajaPageClient({ companyId, accounts, isAdmin }: Props) {
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

  useEffect(() => { load(); }, [load]);

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
            onSuccess={() => { setShowCreate(false); load(); }}
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
          isAdmin={isAdmin}
          onRefresh={load}
        />
      )}
    </div>
  );
}
