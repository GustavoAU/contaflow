"use client";

// src/modules/inventory/components/MovementForm.tsx
// Registro de movimientos físicos (ENTRADA / SALIDA / AJUSTE) — dominio ADMINISTRATIVE

import { useState, useTransition } from "react";
import { createMovementAction } from "../actions/inventory-operations.actions";

type ItemOption = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stockQuantity: string;
  averageCost: string;
};

type Props = {
  companyId: string;
  items: ItemOption[];
  onSuccess?: () => void;
};

const MOVEMENT_TYPES = [
  { value: "ENTRADA", label: "Entrada", description: "Ingreso de mercancía al inventario" },
  { value: "SALIDA", label: "Salida", description: "Egreso de mercancía del inventario" },
  { value: "AJUSTE", label: "Ajuste", description: "Corrección de inventario físico" },
] as const;

type MovementType = (typeof MOVEMENT_TYPES)[number]["value"];

const fieldClass =
  "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

export function MovementForm({ companyId, items, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [movType, setMovType] = useState<MovementType>("ENTRADA");
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  const selectedItem = items.find((i) => i.id === selectedItemId);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);

    const input = {
      companyId,
      itemId: fd.get("itemId") as string,
      type: movType,
      quantity: parseFloat(fd.get("quantity") as string),
      unitCost:
        movType === "ENTRADA" ? parseFloat(fd.get("unitCost") as string) : undefined,
      reference: (fd.get("reference") as string) || null,
      notes: (fd.get("notes") as string) || null,
      date: new Date(fd.get("date") as string).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    };

    startTransition(async () => {
      const r = await createMovementAction(input);
      if (r.success) {
        setSuccess(`Movimiento registrado — ID: ${r.data}`);
        (e.target as HTMLFormElement).reset();
        setSelectedItemId("");
        setMovType("ENTRADA");
        onSuccess?.();
      } else {
        setError(r.error);
      }
    });
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      {/* Tipo de movimiento */}
      <div>
        <label className={labelClass}>Tipo de movimiento *</label>
        <div className="grid grid-cols-3 gap-2">
          {MOVEMENT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setMovType(t.value)}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                movType === t.value
                  ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <div className="font-semibold">{t.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Producto */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Producto *</label>
          <select
            name="itemId"
            required
            className={fieldClass}
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
          >
            <option value="">Seleccionar producto...</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                [{item.sku}] {item.name} — Stock: {parseFloat(item.stockQuantity).toLocaleString("es-VE", { maximumFractionDigits: 2 })} {item.unit}
              </option>
            ))}
          </select>

          {/* Info del ítem seleccionado */}
          {selectedItem && (
            <div className="mt-2 rounded bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
              Stock actual:{" "}
              <span className="font-semibold text-gray-800">
                {parseFloat(selectedItem.stockQuantity).toLocaleString("es-VE", {
                  maximumFractionDigits: 2,
                })}{" "}
                {selectedItem.unit}
              </span>
              {" · "}
              CPP vigente:{" "}
              <span className="font-semibold text-gray-800">
                {parseFloat(selectedItem.averageCost).toLocaleString("es-VE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 4,
                })}
              </span>
              {movType === "SALIDA" && (
                <span className="ml-2 text-blue-600">
                  — El costo unitario se tomará del CPP vigente automáticamente
                </span>
              )}
            </div>
          )}
        </div>

        {/* Cantidad */}
        <div>
          <label className={labelClass}>Cantidad *</label>
          <input
            name="quantity"
            type="number"
            step="0.0001"
            min="0.0001"
            max="1000000"
            required
            className={fieldClass}
            placeholder="0.00"
          />
          {selectedItem && (
            <p className="mt-1 text-xs text-gray-500">Unidad: {selectedItem.unit}</p>
          )}
        </div>

        {/* Costo unitario — solo para ENTRADA */}
        {movType === "ENTRADA" && (
          <div>
            <label className={labelClass}>Costo unitario (VES) *</label>
            <input
              name="unitCost"
              type="number"
              step="0.01"
              min="0"
              max="9999999999"
              required
              className={fieldClass}
              placeholder="0.00"
            />
            <p className="mt-1 text-xs text-gray-500">
              Actualizará el CPP del producto al contabilizarse.
            </p>
          </div>
        )}

        {/* Fecha */}
        <div>
          <label className={labelClass}>Fecha *</label>
          <input
            name="date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className={fieldClass}
          />
        </div>

        {/* Referencia */}
        <div>
          <label className={labelClass}>Referencia</label>
          <input
            name="reference"
            className={fieldClass}
            placeholder="Nro. documento, guía, etc."
            maxLength={100}
          />
        </div>

        {/* Notas */}
        <div className="sm:col-span-2">
          <label className={labelClass}>Notas</label>
          <input
            name="notes"
            className={fieldClass}
            placeholder="Observaciones del movimiento"
            maxLength={500}
          />
        </div>
      </div>

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
        <strong>Nota:</strong> El movimiento quedará en estado <strong>BORRADOR</strong> hasta que
        el Contador lo contabilice. El stock físico no cambia hasta la contabilización.
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Registrando...
            </span>
          ) : "Registrar movimiento"}
        </button>
      </div>
    </form>
  );
}
