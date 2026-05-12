"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { createFixedAssetAction } from "../actions/fixed-asset.actions";

type AccountOption = { id: string; code: string; name: string; type: string };

type Props = {
  companyId: string;
  accounts: AccountOption[];
  onSuccess?: (assetId: string) => void;
};

const METHOD_OPTIONS = [
  { value: "LINEA_RECTA", label: "Línea Recta" },
  { value: "SUMA_DIGITOS", label: "Suma de Dígitos de los Años" },
  { value: "UNIDADES_PRODUCCION", label: "Unidades de Producción" },
] as const;

export function FixedAssetForm({ companyId, accounts, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"LINEA_RECTA" | "SUMA_DIGITOS" | "UNIDADES_PRODUCCION">("LINEA_RECTA");

  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const contraAssetAccounts = accounts.filter((a) => a.type === "CONTRA_ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const input = {
      companyId,
      name: fd.get("name") as string,
      description: (fd.get("description") as string) || null,
      assetAccountId: fd.get("assetAccountId") as string,
      depreciationAccountId: fd.get("depreciationAccountId") as string,
      accDepreciationAccountId: fd.get("accDepreciationAccountId") as string,
      acquisitionDate: new Date(fd.get("acquisitionDate") as string),
      acquisitionCost: fd.get("acquisitionCost") as string,
      residualValue: (fd.get("residualValue") as string) || "0",
      usefulLifeMonths: parseInt(fd.get("usefulLifeMonths") as string),
      depreciationMethod: method,
      totalUnits: method === "UNIDADES_PRODUCCION"
        ? parseInt(fd.get("totalUnits") as string)
        : null,
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
          <label className={labelClass}>Fecha de adquisición *</label>
          <input name="acquisitionDate" type="date" required className={fieldClass} />
        </div>

        <div>
          <label className={labelClass}>Costo de adquisición (VES) *</label>
          <input name="acquisitionCost" type="number" step="0.01" min="0.01" required className={fieldClass} placeholder="0.00" />
        </div>

        <div>
          <label className={labelClass}>Valor residual (VES)</label>
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
            <label className={labelClass}>Cuenta del activo (ASSET) *</label>
            <select name="assetAccountId" required className={fieldClass}>
              <option value="">Seleccionar...</option>
              {assetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Gasto depreciación (EXPENSE) *</label>
            <select name="depreciationAccountId" required className={fieldClass}>
              <option value="">Seleccionar...</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Dep. acumulada (CONTRA_ASSET) *</label>
            <select name="accDepreciationAccountId" required className={fieldClass}>
              <option value="">Seleccionar...</option>
              {contraAssetAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          La cuenta de depreciación acumulada debe ser tipo CONTRA_ASSET (ej: &quot;Dep. Acum. Equipos&quot;).
        </p>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Guardando..." : "Registrar Activo"}
        </button>
      </div>
    </form>
  );
}
