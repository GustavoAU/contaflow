"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { createFixedAssetAction } from "../actions/fixed-asset.actions";

type AccountOption = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  accounts: AccountOption[];
  onSuccess?: (assetId: string) => void;
  onCancel?: () => void;
};

const METHOD_OPTIONS = [
  { value: "LINEA_RECTA", label: "Línea Recta" },
  { value: "SUMA_DIGITOS", label: "Suma de Dígitos de los Años" },
  { value: "UNIDADES_PRODUCCION", label: "Unidades de Producción" },
] as const;

function findBestMatch(pool: AccountOption[], keywords: string[]): string {
  if (pool.length === 0) return "";
  if (pool.length === 1) return pool[0]!.id;
  const lower = keywords.map((k) => k.toLowerCase());
  let bestId = "";
  let bestScore = 0;
  for (const a of pool) {
    const text = `${a.code} ${a.name}`.toLowerCase();
    const score = lower.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestId = a.id;
    }
  }
  return bestId;
}

export function FixedAssetForm({ companyId, accounts, onSuccess, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"LINEA_RECTA" | "SUMA_DIGITOS" | "UNIDADES_PRODUCCION">("LINEA_RECTA");

  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const contraAssetAccounts = accounts.filter((a) => a.type === "CONTRA_ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  const [assetAccountId, setAssetAccountId] = useState(() =>
    findBestMatch(assetAccounts, ["propiedad", "planta", "equipo", "inmueble", "vehiculo", "vehículo", "maquinaria", "mobiliario", "activo fijo"])
  );
  const [depreciationAccountId, setDepreciationAccountId] = useState(() =>
    findBestMatch(expenseAccounts, ["depreci", "amortiz"])
  );
  const [accDepreciationAccountId, setAccDepreciationAccountId] = useState(() =>
    findBestMatch(contraAssetAccounts, ["acumul", "depreci", "amortiz"])
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const input = {
      companyId,
      name: fd.get("name") as string,
      description: (fd.get("description") as string) || null,
      assetAccountId,
      depreciationAccountId,
      accDepreciationAccountId,
      acquisitionDate: new Date(fd.get("acquisitionDate") as string),
      acquisitionCost: fd.get("acquisitionCost") as string,
      residualValue: (fd.get("residualValue") as string) || "0",
      usefulLifeMonths: parseInt(fd.get("usefulLifeMonths") as string),
      depreciationMethod: method,
      totalUnits: method === "UNIDADES_PRODUCCION"
        ? parseInt(fd.get("totalUnits") as string)
        : null,
      location:    (fd.get("location") as string) || null,
      responsible: (fd.get("responsible") as string) || null,
    };

    startTransition(async () => {
      const r = await createFixedAssetAction(input);
      if (r.success) {
        onSuccess?.(r.data);
      } else {
        setError(r.error);
      }
    });
  }

  const fieldClass = "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Datos básicos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre del activo *</label>
          <input name="name" required className={fieldClass} placeholder="Ej: Vehículo Toyota Hilux 2026" />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Descripción</label>
          <input name="description" className={fieldClass} placeholder="Descripción opcional" />
        </div>

        <div>
          <label className={labelClass}>Ubicación</label>
          <input name="location" className={fieldClass} placeholder="Ej: Sede Caracas, Piso 3" maxLength={200} />
        </div>

        <div>
          <label className={labelClass}>Responsable / Custodio</label>
          <input name="responsible" className={fieldClass} placeholder="Nombre del custodio" maxLength={150} />
        </div>

        <div>
          <label className={labelClass}>Fecha de adquisición *</label>
          <input name="acquisitionDate" type="date" required className={fieldClass} />
        </div>

        <div>
          <label className={labelClass}>Costo de adquisición <span className="font-normal text-zinc-400">(Bs.)</span> *</label>
          <input name="acquisitionCost" type="number" step="0.01" min="0.01" required className={fieldClass} placeholder="0.00" />
        </div>

        <div>
          <label className={labelClass}>Valor residual <span className="font-normal text-zinc-400">(Bs.)</span></label>
          <input name="residualValue" type="number" step="0.01" min="0" defaultValue="0" className={fieldClass} />
        </div>

        <div>
          <label className={labelClass}>Vida útil (meses) *</label>
          <input name="usefulLifeMonths" type="number" min="1" required className={fieldClass} placeholder="Ej: 60" />
        </div>
      </div>

      {/* Método de depreciación */}
      <div>
        <label className={labelClass}>Método de depreciación *</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className={fieldClass}
        >
          {METHOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {method === "UNIDADES_PRODUCCION" && (
        <div>
          <label className={labelClass}>Total de unidades a producir *</label>
          <input name="totalUnits" type="number" min="1" required className={fieldClass} placeholder="Ej: 100000" />
        </div>
      )}

      {/* Cuentas contables */}
      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="text-sm font-semibold text-gray-700 px-1">Cuentas contables</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mt-2">
          <div>
            <label className={labelClass}>Cuenta del activo *</label>
            {assetAccounts.length === 0 ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                Sin cuentas tipo Activo. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={assetAccountId}
                onChange={(e) => setAssetAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta ASSET…</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo ASSET — propiedad, planta y equipo</p>
          </div>
          <div>
            <label className={labelClass}>Gasto depreciación *</label>
            {expenseAccounts.length === 0 ? (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                Sin cuentas tipo Gasto. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={depreciationAccountId}
                onChange={(e) => setDepreciationAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta EXPENSE…</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo EXPENSE — gasto por depreciación</p>
          </div>
          <div>
            <label className={labelClass}>Dep. acumulada *</label>
            {contraAssetAccounts.length === 0 ? (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Sin cuentas tipo CONTRA_ASSET. Créalas en el Plan de Cuentas.
              </p>
            ) : (
              <select
                value={accDepreciationAccountId}
                onChange={(e) => setAccDepreciationAccountId(e.target.value)}
                required
                className={fieldClass}
              >
                <option value="">Seleccionar cuenta CONTRA_ASSET…</option>
                {contraAssetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            )}
            <p className="mt-1 text-11 text-zinc-400">Tipo CONTRA_ASSET — depreciación acumulada</p>
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className="inline-flex items-center gap-2 rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          {isPending ? "Guardando…" : "Registrar Activo"}
        </button>
      </div>
    </form>
  );
}
