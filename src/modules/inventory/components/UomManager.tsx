"use client";

// src/modules/inventory/components/UomManager.tsx
// Panel de gestión de unidades de medida por ítem.
// canManage = ACCOUNTING (crear + editar) / canDelete = ADMIN (soft-delete)

import { useState, useTransition, useEffect } from "react";
import {
  listUomsAction,
  createUomAction,
  updateUomAction,
  softDeleteUomAction,
} from "../actions/inventory-uom.actions";

type UnitRow = {
  id: string;
  name: string;
  abbreviation: string;
  conversionFactor: string;
  isBase: boolean;
};

type Props = {
  companyId: string;
  itemId: string;
  itemName: string;
  canManage: boolean;
  canDelete: boolean;
};

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-xs font-medium text-gray-600 mb-1";

function UnitForm({
  companyId,
  itemId,
  existing,
  onDone,
  onCancel,
}: {
  companyId: string;
  itemId: string;
  existing?: UnitRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const abbreviation = (fd.get("abbreviation") as string).trim();
    const conversionFactor = (fd.get("conversionFactor") as string).trim();
    const isBase = fd.get("isBase") === "on";

    startTransition(async () => {
      const r = existing
        ? await updateUomAction({ unitId: existing.id, companyId, name, abbreviation, conversionFactor })
        : await createUomAction({ companyId, itemId, name, abbreviation, conversionFactor, isBase });

      if (r.success) {
        onDone();
      } else {
        setError(r.error);
      }
    });
  }

  const factorDisabled = !!existing; // factor se bloquea en edición si hay movimientos; el service retorna error

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-800">
        {existing ? `Editar unidad: ${existing.name}` : "Nueva unidad de medida"}
      </p>

      {error && (
        <p className="rounded bg-red-50 border border-red-200 px-3 py-1.5 text-xs text-red-700">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Nombre *</label>
          <input
            name="name"
            required
            defaultValue={existing?.name}
            maxLength={60}
            className={fieldClass}
            placeholder="Ej: Caja"
          />
        </div>
        <div>
          <label className={labelClass}>Abreviatura *</label>
          <input
            name="abbreviation"
            required
            defaultValue={existing?.abbreviation}
            maxLength={10}
            className={fieldClass}
            placeholder="Ej: CJ"
          />
        </div>
        <div>
          <label className={labelClass}>Factor de conversión *</label>
          <input
            name="conversionFactor"
            required
            defaultValue={existing?.conversionFactor}
            className={fieldClass}
            placeholder="Ej: 12"
            disabled={factorDisabled}
            title={factorDisabled ? "El factor no se puede cambiar aquí; use Actualizar para intentarlo." : undefined}
          />
          {factorDisabled && (
            <p className="mt-0.5 text-xs text-amber-600">Inmutable si existen movimientos.</p>
          )}
        </div>
        {!existing && (
          <div className="flex items-center gap-2 pt-5">
            <input type="checkbox" name="isBase" id="isBase-cb" className="h-4 w-4" />
            <label htmlFor="isBase-cb" className="text-xs text-gray-700">Unidad base</label>
          </div>
        )}
      </div>

      {!existing && (
        <p className="text-xs text-gray-500">
          Factor = cuántas unidades base equivale 1 de esta unidad. Ej: 1 Caja = 12 unidades → factor 12.
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Guardando..." : existing ? "Guardar cambios" : "Crear unidad"}
        </button>
      </div>
    </form>
  );
}

export function UomManager({ companyId, itemId, itemName, canManage, canDelete }: Props) {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoad] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<UnitRow | null>(null);

  function loadUnits() {
    startLoad(async () => {
      const r = await listUomsAction({ companyId, itemId });
      if (r.success) {
        setUnits(
          r.data.map((u) => ({
            id: u.id,
            name: u.name,
            abbreviation: u.abbreviation,
            conversionFactor: u.conversionFactor.toString(),
            isBase: u.isBase,
          }))
        );
        setLoadError(null);
      } else {
        setLoadError(r.error);
      }
    });
  }

  useEffect(() => {
    loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  function handleDelete(unit: UnitRow) {
    if (!confirm(`¿Eliminar la unidad "${unit.name}"? Esta acción no se puede deshacer si existen movimientos.`))
      return;
    setDeleteError(null);
    startDelete(async () => {
      const r = await softDeleteUomAction({ unitId: unit.id, companyId });
      if (r.success) {
        loadUnits();
      } else {
        setDeleteError(r.error);
      }
    });
  }

  function handleFormDone() {
    setFormMode(null);
    setEditTarget(null);
    loadUnits();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">
          Unidades de medida — {itemName}
        </p>
        {canManage && formMode === null && (
          <button
            onClick={() => { setFormMode("create"); setEditTarget(null); }}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            + Agregar unidad
          </button>
        )}
      </div>

      {loadError && (
        <p className="text-xs text-red-600">{loadError}</p>
      )}
      {deleteError && (
        <p className="text-xs text-red-600">{deleteError}</p>
      )}

      {isLoading ? (
        <p className="text-xs text-gray-400">Cargando unidades...</p>
      ) : units.length === 0 ? (
        <p className="text-xs text-gray-500">
          Sin unidades configuradas.{canManage ? " Agrega una unidad base para este producto." : ""}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase font-semibold">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Nombre</th>
                <th scope="col" className="px-3 py-2 text-left">Abrev.</th>
                <th scope="col" className="px-3 py-2 text-right">Factor</th>
                <th scope="col" className="px-3 py-2 text-center">Tipo</th>
                {(canManage || canDelete) && (
                  <th scope="col" className="px-3 py-2 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {units.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800">{u.name}</td>
                  <td className="px-3 py-2 text-gray-500 font-mono">{u.abbreviation}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-700">{u.conversionFactor}</td>
                  <td className="px-3 py-2 text-center">
                    {u.isBase ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 font-semibold">Base</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Alt.</span>
                    )}
                  </td>
                  {(canManage || canDelete) && (
                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center gap-3">
                        {canManage && formMode === null && (
                          <button
                            onClick={() => { setEditTarget(u); setFormMode("edit"); }}
                            className="text-blue-600 hover:underline"
                          >
                            Editar
                          </button>
                        )}
                        {canDelete && !u.isBase && (
                          <button
                            onClick={() => handleDelete(u)}
                            disabled={isDeleting}
                            className="text-red-600 hover:underline disabled:opacity-40"
                          >
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formMode === "create" && (
        <UnitForm
          companyId={companyId}
          itemId={itemId}
          onDone={handleFormDone}
          onCancel={() => setFormMode(null)}
        />
      )}

      {formMode === "edit" && editTarget && (
        <UnitForm
          companyId={companyId}
          itemId={itemId}
          existing={editTarget}
          onDone={handleFormDone}
          onCancel={() => { setFormMode(null); setEditTarget(null); }}
        />
      )}
    </div>
  );
}
