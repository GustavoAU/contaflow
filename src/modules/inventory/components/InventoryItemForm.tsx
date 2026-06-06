"use client";

// src/modules/inventory/components/InventoryItemForm.tsx
// Formulario para crear y editar ítems de inventario (ADMINISTRATIVE / OWNER / ADMIN)
// Auditoría SENIAT:
//   H-03: cuentas filtradas por tipo (ASSET para inventario, EXPENSE para COGS)
//   R-01: cuentas obligatorias para productos físicos (GOODS/RAW_MATERIAL/FINISHED_GOOD)
//   R-06: tipo de producto — SERVICE bloquea movimientos físicos
//   R-10: minimumStock configurable al crear el producto

import { useState, useTransition } from "react";
import { createInventoryItemAction, updateInventoryItemAction } from "../actions/inventory-operations.actions";
import type { ItemTypeValue, DefaultTaxRate } from "../schemas/inventory-item.schema";
import { PHYSICAL_ITEM_TYPES, TAX_RATE_LABELS, TAX_RATE_OPTIONS } from "../schemas/inventory-item.schema";

type AccountOption = { id: string; code: string; name: string; type: string };

type ExistingItem = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  itemType: string;
  defaultTaxRate: string;
  minimumStock: string | null;
  accountId: string | null;
  cogsAccountId: string | null;
};

type Props = {
  companyId: string;
  accounts: AccountOption[];      // todas las cuentas de la empresa
  item?: ExistingItem;
  onSuccess?: () => void;
  onCancel?: () => void;
};

const ITEM_TYPE_OPTIONS: { value: ItemTypeValue; label: string; description: string }[] = [
  { value: "GOODS", label: "Mercancía", description: "Para reventa — tiene stock físico" },
  { value: "RAW_MATERIAL", label: "Materia prima", description: "Insumo productivo — tiene stock" },
  { value: "FINISHED_GOOD", label: "Producto terminado", description: "Producción propia — tiene stock" },
  { value: "SERVICE", label: "Servicio", description: "Intangible — sin stock físico (NIIF Sec.13)" },
];

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

export function InventoryItemForm({ companyId, accounts, item, onSuccess, onCancel }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [itemType, setItemType] = useState<ItemTypeValue>(
    (item?.itemType as ItemTypeValue | undefined) ?? "GOODS"
  );
  const [taxRate, setTaxRate] = useState<DefaultTaxRate>(
    (item?.defaultTaxRate as DefaultTaxRate | undefined) ?? "GENERAL"
  );

  const isEditing = !!item;
  const isPhysical = PHYSICAL_ITEM_TYPES.has(itemType);

  // H-03: filtrar cuentas por naturaleza contable
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const minimumStockRaw = fd.get("minimumStock") as string;
    const minimumStockVal = minimumStockRaw ? parseFloat(minimumStockRaw) : null;

    startTransition(async () => {
      let result;

      if (isEditing) {
        result = await updateInventoryItemAction({
          itemId: item.id,
          companyId,
          sku: fd.get("sku") as string,
          name: fd.get("name") as string,
          description: (fd.get("description") as string) || null,
          itemType,
          defaultTaxRate: taxRate,
          minimumStock: minimumStockVal,
          accountId: isPhysical ? ((fd.get("accountId") as string) || null) : null,
          cogsAccountId: isPhysical ? ((fd.get("cogsAccountId") as string) || null) : null,
        });
      } else {
        result = await createInventoryItemAction({
          companyId,
          sku: fd.get("sku") as string,
          name: fd.get("name") as string,
          description: (fd.get("description") as string) || null,
          itemType,
          defaultTaxRate: taxRate,
          minimumStock: minimumStockVal,
          accountId: isPhysical ? ((fd.get("accountId") as string) || null) : null,
          cogsAccountId: isPhysical ? ((fd.get("cogsAccountId") as string) || null) : null,
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

      {/* Tipo de producto — R-06 */}
      <div>
        <label className={labelClass}>Tipo de producto *</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ITEM_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setItemType(opt.value)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                itemType === opt.value
                  ? "border-blue-500 bg-blue-50 text-blue-800"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <div className="font-semibold">{opt.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
        {!isPhysical && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-200">
            ⚠️ Los servicios no tienen stock físico (NIIF para PYMES Sec. 13). Solo se permiten Ajustes de corrección. No requieren cuentas contables de inventario.
          </p>
        )}
      </div>

      {/* BC-001: Alícuota IVA por defecto — Ley IVA Art. 27 */}
      <div>
        <label className={labelClass}>
          Alícuota IVA por defecto <span className="text-red-500">*</span>
        </label>
        <select
          value={taxRate}
          onChange={(e) => setTaxRate(e.target.value as DefaultTaxRate)}
          className={fieldClass}
          required
        >
          {TAX_RATE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {TAX_RATE_LABELS[opt]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Ley IVA Art. 27 — Pre-clasifica el bien para aplicar la alícuota correcta al facturar.
        </p>
      </div>

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
          {/* R-10: stock mínimo en creación */}
          <label className={labelClass}>Stock mínimo {!isPhysical && <span className="text-gray-400 font-normal">(no aplica a servicios)</span>}</label>
          <input
            name="minimumStock"
            type="number"
            step="0.01"
            min="0"
            disabled={!isPhysical}
            defaultValue={item?.minimumStock ? parseFloat(item.minimumStock).toString() : ""}
            className={`${fieldClass} ${!isPhysical ? "bg-gray-50 text-gray-400" : ""}`}
            placeholder="Ej: 5"
          />
          {isPhysical && (
            <p className="mt-1 text-xs text-gray-400">Alerta cuando el stock caiga por debajo de este nivel.</p>
          )}
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

      {/* Cuentas contables — H-03: filtradas por tipo / R-01: obligatorias para físicos */}
      {isPhysical && (
        <fieldset className="rounded-lg border border-gray-200 p-4">
          <legend className="text-sm font-semibold text-gray-700 px-1">
            Cuentas contables <span className="text-red-500">*</span>
          </legend>
          <p className="mt-1 mb-3 text-xs text-gray-500">
            Obligatorias para que el Contador pueda contabilizar los movimientos en el Libro Mayor.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>
                Cuenta de inventario (ASSET) <span className="text-red-500">*</span>
              </label>
              <select
                name="accountId"
                required={isPhysical}
                className={fieldClass}
                defaultValue={item?.accountId ?? ""}
              >
                <option value="">— Seleccionar cuenta ACTIVO —</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Solo muestra cuentas de Activo (11xx)</p>
            </div>
            <div>
              <label className={labelClass}>
                Cuenta COGS (EXPENSE) <span className="text-red-500">*</span>
              </label>
              <select
                name="cogsAccountId"
                required={isPhysical}
                className={fieldClass}
                defaultValue={item?.cogsAccountId ?? ""}
              >
                <option value="">— Seleccionar cuenta GASTO —</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Solo muestra cuentas de Gasto/Costo (51xx)</p>
            </div>
          </div>
        </fieldset>
      )}

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
          aria-busy={isPending}
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
