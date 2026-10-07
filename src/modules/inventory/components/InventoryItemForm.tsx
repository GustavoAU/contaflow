"use client";

// src/modules/inventory/components/InventoryItemForm.tsx
// Formulario para crear y editar ítems de inventario (ADMINISTRATIVE / OWNER / ADMIN)
// Auditoría SENIAT:
//   H-03: cuentas filtradas por tipo (ASSET para inventario, EXPENSE para COGS)
//   R-01: cuentas obligatorias para productos físicos (GOODS/RAW_MATERIAL/FINISHED_GOOD)
//   R-06: tipo de producto — SERVICE bloquea movimientos físicos
//   R-10: minimumStock configurable al crear el producto
// SPEC-012 B3: las dos cuentas (inventario / Activo y costo de ventas / Gasto) son `AccountCombobox` con
//   ESTADO (antes `FormData` + `defaultValue`). `accounts` trae títulos Y cuentas de movimiento; los títulos
//   solo se ven como encabezados no elegibles. Sin `required` nativo: el envío revalida cada cuenta con
//   `isSelectableAccountId` contra las listas VIGENTES y nunca llama a la acción con un valor no elegible.
//   Q4 (solo edición de un ítem físico): si una cuenta guardada es un título, ya no existe o no es de su tipo,
//   `SavedAccountsAlert` la lista, el botón de guardar queda deshabilitado y el `submit` retorna.

import { useId, useState, useTransition } from "react";
import {
  createInventoryItemAction,
  updateInventoryItemAction,
} from "../actions/inventory-operations.actions";
import type { ItemTypeValue, DefaultTaxRate } from "../schemas/inventory-item.schema";
import {
  PHYSICAL_ITEM_TYPES,
  TAX_RATE_LABELS,
  TAX_RATE_OPTIONS,
} from "../schemas/inventory-item.schema";
import { AccountCombobox } from "@/components/accounting/AccountCombobox";
import { SavedAccountsAlert } from "@/components/accounting/SavedAccountsAlert";
import {
  isSelectableAccountId,
  unselectableSavedAccounts,
  type AccountWithType,
} from "@/lib/account-search";

// `isPostable` es OBLIGATORIO: sin él el combobox trataría todas las cuentas como títulos.
type AccountOption = AccountWithType;

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
  accounts: AccountOption[]; // títulos Y cuentas de movimiento de la empresa (cada campo filtra por su tipo)
  item?: ExistingItem;
  onSuccess?: () => void;
  onCancel?: () => void;
};

const ITEM_TYPE_OPTIONS: { value: ItemTypeValue; label: string; description: string }[] = [
  { value: "GOODS", label: "Mercancía", description: "Para reventa — tiene stock físico" },
  { value: "RAW_MATERIAL", label: "Materia prima", description: "Insumo productivo — tiene stock" },
  {
    value: "FINISHED_GOOD",
    label: "Producto terminado",
    description: "Producción propia — tiene stock",
  },
  {
    value: "SERVICE",
    label: "Servicio",
    description: "Intangible — sin stock físico (NIIF Sec.13)",
  },
];

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

// Las etiquetas visibles son también los rótulos con los que la alerta de Q4 y el error de envío nombran
// a cada campo: el usuario los ve tal como los lee en el formulario.
const INVENTORY_ACCOUNT_LABEL = "Cuenta de inventario (Activo)";
const COGS_ACCOUNT_LABEL = "Cuenta de costo de ventas (Gasto)";

export function InventoryItemForm({ companyId, accounts, item, onSuccess, onCancel }: Props) {
  const uid = useId();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [itemType, setItemType] = useState<ItemTypeValue>(
    (item?.itemType as ItemTypeValue | undefined) ?? "GOODS"
  );
  const [taxRate, setTaxRate] = useState<DefaultTaxRate>(
    (item?.defaultTaxRate as DefaultTaxRate | undefined) ?? "GENERAL"
  );
  // D6: estado, no FormData. En edición arrancan con lo guardado (puede ser un título o una cuenta ausente).
  const [accountId, setAccountId] = useState(item?.accountId ?? "");
  const [cogsAccountId, setCogsAccountId] = useState(item?.cogsAccountId ?? "");
  // Tras un envío rechazado por falta de cuenta, los campos inválidos se marcan (aria-invalid + mensaje).
  const [accountsChecked, setAccountsChecked] = useState(false);

  const isEditing = !!item;
  const isPhysical = PHYSICAL_ITEM_TYPES.has(itemType);

  // H-03: filtrar cuentas por naturaleza contable. Cada lista conserva sus títulos (encabezados del
  // combobox); `isSelectableAccountId` decide qué se puede elegir.
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");

  const inventoryValid = isSelectableAccountId(assetAccounts, accountId);
  const cogsValid = isSelectableAccountId(expenseAccounts, cogsAccountId);
  const inventoryInvalid = accountsChecked && !inventoryValid;
  const cogsInvalid = accountsChecked && !cogsValid;

  // Q4: solo en edición de un ítem FÍSICO (un servicio no muestra selectores y envía null), con los valores
  // ACTUALES y cada uno contra SU lista. Un campo vacío ("sin configurar") no es un problema aquí: lo
  // atrapa la validación del envío.
  const alertId = `${uid}-saved-accounts`;
  const problems =
    isEditing && isPhysical
      ? unselectableSavedAccounts([
          {
            key: "accountId",
            label: INVENTORY_ACCOUNT_LABEL,
            value: accountId,
            accounts: assetAccounts,
          },
          {
            key: "cogsAccountId",
            label: COGS_ACCOUNT_LABEL,
            value: cogsAccountId,
            accounts: expenseAccounts,
          },
        ])
      : [];
  const blocked = problems.length > 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Defensa en profundidad (Q4): el botón ya está deshabilitado, pero un `submit` (Enter) no debe guardar.
    if (blocked) return;

    // R-01 + L-2: cuentas obligatorias para productos físicos, revalidadas contra las listas VIGENTES.
    // Ya no hay `required` nativo: un título, una cuenta ausente o un campo vacío no cuentan como elegidos.
    if (isPhysical) {
      const missing: string[] = [];
      if (!inventoryValid) missing.push(INVENTORY_ACCOUNT_LABEL);
      if (!cogsValid) missing.push(COGS_ACCOUNT_LABEL);
      if (missing.length > 0) {
        setAccountsChecked(true);
        setError(`Selecciona una cuenta de movimiento para: ${missing.join(", ")}.`);
        return;
      }
    }

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
          accountId: isPhysical ? accountId : null,
          cogsAccountId: isPhysical ? cogsAccountId : null,
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
          accountId: isPhysical ? accountId : null,
          cogsAccountId: isPhysical ? cogsAccountId : null,
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
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
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
              <div className="mt-0.5 text-xs text-gray-500">{opt.description}</div>
            </button>
          ))}
        </div>
        {!isPhysical && (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⚠️ Los servicios no tienen stock físico (NIIF para PYMES Sec. 13). Solo se permiten
            Ajustes de corrección. No requieren cuentas contables de inventario.
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
          <label className={labelClass}>
            Stock mínimo{" "}
            {!isPhysical && (
              <span className="font-normal text-gray-400">(no aplica a servicios)</span>
            )}
          </label>
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
            <p className="mt-1 text-xs text-gray-400">
              Alerta cuando el stock caiga por debajo de este nivel.
            </p>
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
          <legend className="px-1 text-sm font-semibold text-gray-700">
            Cuentas contables <span className="text-red-500">*</span>
          </legend>
          <p className="mt-1 mb-3 text-xs text-gray-500">
            Obligatorias para que el Contador pueda contabilizar los movimientos en el Libro Mayor.
          </p>
          {/* Q4: cuentas guardadas que ya no se pueden usar; bloquean el guardado hasta corregirlas. */}
          {blocked && (
            <div className="mb-3">
              <SavedAccountsAlert id={alertId} problems={problems} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-inventory`} className={labelClass}>
                {INVENTORY_ACCOUNT_LABEL}{" "}
                <span aria-hidden="true" className="text-red-600">
                  *
                </span>
              </label>
              <AccountCombobox
                id={`${uid}-inventory`}
                accounts={assetAccounts}
                value={accountId}
                onChange={setAccountId}
                aria-invalid={inventoryInvalid || undefined}
                aria-describedby={`${uid}-inventory-hint${inventoryInvalid ? ` ${uid}-inventory-error` : ""}`}
              />
              <p id={`${uid}-inventory-hint`} className="mt-1 text-xs text-gray-600">
                Solo cuentas de Activo
              </p>
              {inventoryInvalid && (
                <p id={`${uid}-inventory-error`} className="mt-1 text-xs font-medium text-red-600">
                  Selecciona una cuenta de movimiento.
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${uid}-cogs`} className={labelClass}>
                {COGS_ACCOUNT_LABEL}{" "}
                <span aria-hidden="true" className="text-red-600">
                  *
                </span>
              </label>
              <AccountCombobox
                id={`${uid}-cogs`}
                accounts={expenseAccounts}
                value={cogsAccountId}
                onChange={setCogsAccountId}
                aria-invalid={cogsInvalid || undefined}
                aria-describedby={`${uid}-cogs-hint${cogsInvalid ? ` ${uid}-cogs-error` : ""}`}
              />
              <p id={`${uid}-cogs-hint`} className="mt-1 text-xs text-gray-600">
                Solo cuentas de Gasto
              </p>
              {cogsInvalid && (
                <p id={`${uid}-cogs-error`} className="mt-1 text-xs font-medium text-red-600">
                  Selecciona una cuenta de movimiento.
                </p>
              )}
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
          disabled={isPending || blocked}
          aria-busy={isPending}
          aria-describedby={blocked ? alertId : undefined}
          className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {isEditing ? "Guardando..." : "Creando..."}
            </span>
          ) : isEditing ? (
            "Guardar cambios"
          ) : (
            "Crear producto"
          )}
        </button>
      </div>
    </form>
  );
}
