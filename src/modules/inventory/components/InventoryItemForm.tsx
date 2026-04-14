"use client";

// src/modules/inventory/components/InventoryItemForm.tsx
// Formulario para crear y editar ítems de inventario (ADMINISTRATIVE / OWNER / ADMIN)

import { useState, useTransition } from "react";
import { createInventoryItemAction, updateInventoryItemAction } from "../actions/inventory-operations.actions";

type AccountOption = { id: string; code: string; name: string };

type ExistingItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  accountId: string | null;
  cogsAccountId: string | null;
};

type Props = {
  companyId: string;
  accounts: AccountOption[];
  item?: ExistingItem;
  onSuccess?: () => void;
  onCancel?: () => void;
};

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

export function InventoryItemForm({ companyId, accounts, item, onSuccess, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!item;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      let result;

      if (isEditing) {
        result = await updateInventoryItemAction({
          itemId: item.id,
          companyId,
          sku: fd.get("sku") as string,
          name: fd.get("name") as string,
          description: (fd.get("description") as string) || null,
          unit: fd.get("unit") as string,
          accountId: (fd.get("accountId") as string) || null,
          cogsAccountId: (fd.get("cogsAccountId") as string) || null,
        });
      } else {
        result = await createInventoryItemAction({
          companyId,
          sku: fd.get("sku") as string,
          name: fd.get("name") as string,
          description: (fd.get("description") as string) || null,
          unit: fd.get("unit") as string,
          accountId: (fd.get("accountId") as string) || null,
          cogsAccountId: (fd.get("cogsAccountId") as string) || null,
        });
      }

      if (result.success) {
        onSuccess?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>SKU *</label>
          <input
            name="sku"
            required
            defaultValue={item?.sku}
            className={fieldClass}
            placeholder="Ej: PROD-001"
            maxLength={50}
          />
        </div>

        <div>
          <label className={labelClass}>Unidad de medida *</label>
          <input
            name="unit"
            required
            defaultValue={item?.unit}
            className={fieldClass}
            placeholder="Ej: unidad, kg, litro"
            maxLength={30}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Nombre del producto *</label>
          <input
            name="name"
            required
            defaultValue={item?.name}
            className={fieldClass}
            placeholder="Nombre descriptivo del producto"
            maxLength={120}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Descripción</label>
          <input
            name="description"
            defaultValue={item?.description ?? ""}
            className={fieldClass}
            placeholder="Descripción opcional"
            maxLength={500}
          />
        </div>
      </div>

      {/* Cuentas contables */}
      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="text-sm font-semibold text-gray-700 px-1">
          Cuentas contables (opcional)
        </legend>
        <p className="mt-1 mb-3 text-xs text-gray-500">
          Requeridas para que el Contador pueda contabilizar los movimientos.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Cuenta de inventario (ASSET)</label>
            <select name="accountId" className={fieldClass} defaultValue={item?.accountId ?? ""}>
              <option value="">Sin asignar</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Cuenta COGS (EXPENSE)</label>
            <select
              name="cogsAccountId"
              className={fieldClass}
              defaultValue={item?.cogsAccountId ?? ""}
            >
              <option value="">Sin asignar</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {isEditing ? "Guardando..." : "Creando..."}
            </span>
          ) : isEditing ? "Guardar cambios" : "Crear producto"}
        </button>
      </div>
    </form>
  );
}
