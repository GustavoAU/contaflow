"use client";

// src/modules/inventory/components/InventoryItemList.tsx
// Tabla de ítems con stock y CPP. Accesible para todos los roles con acceso al módulo.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { XCircleIcon, AlertTriangleIcon, MoreHorizontal, Pencil, Trash2, History } from "lucide-react";
import { softDeleteInventoryItemAction, getItemMovementsAction } from "../actions/inventory-operations.actions";
import { InventoryItemForm } from "./InventoryItemForm";
import { ItemMovementHistory, type MovementRow } from "./ItemMovementHistory";
import { UomManager } from "./UomManager";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type InventoryItemRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;           // baseUnitName — solo lectura, gestionado vía UomManager
  stockQuantity: string;
  averageCost: string;
  itemType: string;         // R-06: GOODS | SERVICE | RAW_MATERIAL | FINISHED_GOOD
  defaultTaxRate: string;   // BC-001: alícuota IVA por defecto — Ley IVA Art. 27
  minimumStock: string | null; // R-10: alerta bajo stock
  accountId: string | null;
  cogsAccountId: string | null;
  accountCode?: string | null;
  accountName?: string | null;
};

type AccountOption = { id: string; code: string; name: string; type: string };

type Props = {
  items: InventoryItemRow[];
  companyId: string;
  accounts: AccountOption[];
  canEdit: boolean;           // OPERATIONS roles
  canDelete: boolean;         // ADMIN_ONLY roles
  canManageUom?: boolean;     // ACCOUNTING roles — gestionar unidades de medida
  canViewHistory?: boolean;   // WRITERS y superior — default true
};

const ITEM_TYPE_BADGE: Record<string, string> = {
  GOODS: "bg-blue-50 text-blue-700",
  SERVICE: "bg-amber-50 text-amber-700",
  RAW_MATERIAL: "bg-purple-50 text-purple-700",
  FINISHED_GOOD: "bg-green-50 text-green-700",
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  GOODS: "Mercancía",
  SERVICE: "Servicio",
  RAW_MATERIAL: "Materia prima",
  FINISHED_GOOD: "Prod. terminado",
};

export function InventoryItemList({ items, companyId, accounts, canEdit, canDelete, canManageUom = false, canViewHistory = true }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uomItemId, setUomItemId] = useState<string | null>(null);
  const [historyItemId, setHistoryItemId] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, MovementRow[]>>({});
  const [historyError, setHistoryError] = useState<Record<string, string>>({});
  const [isPendingDelete, startDelete] = useTransition();
  const [isPendingHistory, startHistory] = useTransition();

  function handleDelete(itemId: string, itemName: string) {
    if (!confirm(`¿Eliminar "${itemName}" del inventario? Esta acción es reversible solo manualmente.`))
      return;
    startDelete(async () => {
      const r = await softDeleteInventoryItemAction(companyId, itemId);
      if (r.success) toast.success(`"${itemName}" eliminado.`);
      else toast.error(r.error);
    });
  }

  function handleToggleHistory(item: InventoryItemRow) {
    if (historyItemId === item.id) {
      setHistoryItemId(null);
      return;
    }
    setHistoryItemId(item.id);
    if (historyData[item.id]) return; // ya cargado

    startHistory(async () => {
      const r = await getItemMovementsAction(companyId, item.id);
      if (r.success) {
        setHistoryData((prev) => ({ ...prev, [item.id]: r.data as MovementRow[] }));
        setHistoryError((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
      } else {
        setHistoryError((prev) => ({ ...prev, [item.id]: r.error }));
      }
    });
  }

  // La columna Historial sólo aparece cuando el rol no tiene dropdown de acciones;
  // en ese caso "Ver historial" está dentro del menú ⋮.
  const showHistorialCol = canViewHistory && !(canEdit || canDelete);
  const totalCols = 8 + (showHistorialCol ? 1 : 0) + (canManageUom ? 1 : 0) + (canEdit || canDelete ? 1 : 0);

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No hay productos registrados en el inventario.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">SKU</th>
                <th scope="col" className="px-4 py-3 text-left">Nombre</th>
                <th scope="col" className="px-4 py-3 text-left">Tipo</th>
                <th scope="col" className="px-4 py-3 text-left">Unidad</th>
                <th scope="col" className="px-4 py-3 text-right">Stock</th>
                <th scope="col" className="px-4 py-3 text-right">CPP (Costo Prom.)</th>
                <th scope="col" className="px-4 py-3 text-right">Valor en libros</th>
                <th scope="col" className="px-4 py-3 text-left">Cta. Inventario</th>
                {canManageUom && (
                  <th scope="col" className="px-4 py-3 text-center">Unidades</th>
                )}
                {showHistorialCol && (
                  <th scope="col" className="px-4 py-3 text-center">Historial</th>
                )}
                {(canEdit || canDelete) && (
                  <th scope="col" className="px-4 py-3 text-right w-14"></th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const stock = parseFloat(item.stockQuantity);
                const cpp = parseFloat(item.averageCost);
                const valor = stock * cpp;
                const isEditing = editingId === item.id;
                const isHistoryOpen = historyItemId === item.id;
                const minStock = item.minimumStock ? parseFloat(item.minimumStock) : null;
                const isBelowMin = minStock !== null && stock < minStock && item.itemType !== "SERVICE";

                return (
                  <>
                    <tr key={item.id} className={`hover:bg-gray-50 ${isBelowMin ? "bg-amber-50/40" : ""}`}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">{item.sku}</td>
                      <td className="px-4 py-3 max-w-55">
                        <p className="font-medium text-gray-900 truncate" title={item.name}>
                          {item.name}
                        </p>
                        {item.description && (
                          <p className="text-xs text-gray-400 truncate">{item.description}</p>
                        )}
                        {isBelowMin && (
                          <p className="text-xs text-amber-700 font-semibold mt-0.5">
                            ⚠ Stock bajo (mín: {minStock})
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${ITEM_TYPE_BADGE[item.itemType] ?? "bg-gray-100 text-gray-600"}`}>
                          {ITEM_TYPE_LABEL[item.itemType] ?? item.itemType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{item.unit}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {item.itemType === "SERVICE" ? (
                          <span className="text-gray-400 text-xs">N/A</span>
                        ) : (
                          /* Q2-5: icono + color — doble indicador daltonismo (WCAG 1.4.1) */
                          <span className={`inline-flex items-center gap-1 ${
                            stock === 0
                              ? "text-red-600 font-semibold"
                              : isBelowMin
                                ? "text-amber-600 font-semibold"
                                : "text-gray-800"
                          }`}>
                            {stock === 0 && <XCircleIcon className="h-3.5 w-3.5 shrink-0" aria-label="Sin stock" />}
                            {stock > 0 && isBelowMin && <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" aria-label="Stock bajo" />}
                            {stock.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-700">
                        {item.itemType === "SERVICE" ? (
                          <span className="text-gray-400 text-xs">N/A</span>
                        ) : (
                          cpp.toLocaleString("es-VE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                        {item.itemType === "SERVICE" ? (
                          <span className="text-gray-400 text-xs">N/A</span>
                        ) : (
                          valor.toLocaleString("es-VE", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {item.itemType === "SERVICE" ? (
                          <span className="text-gray-400">Sin cuenta (servicio)</span>
                        ) : item.accountCode ? (
                          `${item.accountCode} — ${item.accountName}`
                        ) : (
                          <span className="text-yellow-600">Sin cuenta</span>
                        )}
                      </td>
                      {canManageUom && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setUomItemId(uomItemId === item.id ? null : item.id)}
                            className="text-xs text-emerald-600 hover:underline"
                          >
                            {uomItemId === item.id ? "Ocultar" : "Unidades"}
                          </button>
                        </td>
                      )}
                      {showHistorialCol && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleHistory(item)}
                            disabled={isPendingHistory && historyItemId === item.id}
                            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                          >
                            {isHistoryOpen ? "Ocultar" : isPendingHistory && historyItemId === item.id ? "Cargando..." : "Ver historial"}
                          </button>
                        </td>
                      )}
                      {(canEdit || canDelete) && (
                        <td className="px-4 py-2 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
                                aria-label="Acciones del producto"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {canEdit && (
                                <DropdownMenuItem onClick={() => setEditingId(isEditing ? null : item.id)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                  {isEditing ? "Cancelar edición" : "Editar producto"}
                                </DropdownMenuItem>
                              )}
                              {canViewHistory && (
                                <DropdownMenuItem onClick={() => handleToggleHistory(item)}>
                                  <History className="h-3.5 w-3.5" />
                                  {isHistoryOpen ? "Ocultar historial" : "Ver historial"}
                                </DropdownMenuItem>
                              )}
                              {canDelete && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600 focus:bg-red-50 focus:text-red-600"
                                    onClick={() => handleDelete(item.id, item.name)}
                                    disabled={isPendingDelete}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Eliminar
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>

                    {/* Panel de unidades de medida */}
                    {uomItemId === item.id && (
                      <tr key={`uom-${item.id}`}>
                        <td colSpan={totalCols} className="bg-emerald-50 px-6 py-4">
                          <UomManager
                            companyId={companyId}
                            itemId={item.id}
                            itemName={item.name}
                            canManage={canManageUom}
                            canDelete={canDelete}
                          />
                        </td>
                      </tr>
                    )}

                    {/* Panel de historial — fila de ancho completo */}
                    {isHistoryOpen && (
                      <tr key={`history-${item.id}`}>
                        <td colSpan={totalCols} className="bg-indigo-50 px-6 py-4">
                          <ItemMovementHistory
                            companyId={companyId}
                            itemName={item.name}
                            sku={item.sku}
                            stockQuantity={item.stockQuantity}
                            averageCost={item.averageCost}
                            unit={item.unit}
                            movements={historyData[item.id] ?? null}
                            error={historyError[item.id] ?? null}
                          />
                        </td>
                      </tr>
                    )}

                    {/* Formulario de edición inline */}
                    {isEditing && (
                      <tr key={`edit-${item.id}`}>
                        <td colSpan={totalCols} className="bg-blue-50 px-6 py-4">
                          <p className="mb-3 text-sm font-medium text-blue-800">
                            Editando: {item.name}
                          </p>
                          <InventoryItemForm
                            companyId={companyId}
                            accounts={accounts}
                            item={{
                              id: item.id,
                              sku: item.sku,
                              name: item.name,
                              description: item.description,
                              itemType: item.itemType,
                              defaultTaxRate: item.defaultTaxRate,
                              minimumStock: item.minimumStock,
                              accountId: item.accountId,
                              cogsAccountId: item.cogsAccountId,
                            }}
                            onSuccess={() => setEditingId(null)}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
