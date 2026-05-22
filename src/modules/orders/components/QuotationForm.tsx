"use client";
// src/modules/orders/components/QuotationForm.tsx
// Formulario de creación de cotización/presupuesto con líneas dinámicas

import { useTransition, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { createQuotationAction } from "../actions/quotation.actions";

interface Props {
  companyId: string;
  onSuccess?: (id: string, number: string) => void;
}

const TAX_RATES = [
  { value: "0", label: "0% — Exento" },
  { value: "8", label: "8% — Reducido" },
  { value: "16", label: "16% — General" },
];

const DEFAULT_ITEM = { description: "", unit: "und", quantity: "1", unitPrice: "", taxRate: "16" };

export function QuotationForm({ companyId, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"PURCHASE" | "SALE">("PURCHASE");
  const [counterpartName, setCounterpartName] = useState("");
  const [counterpartRif, setCounterpartRif] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [items, setItems] = useState([{ ...DEFAULT_ITEM }]);

  function addItem() {
    setItems((prev) => [...prev, { ...DEFAULT_ITEM }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, field: string, value: string) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createQuotationAction(companyId, {
        type,
        counterpartName,
        counterpartRif: counterpartRif || undefined,
        validUntil,
        notes: notes || undefined,
        currency,
        items,
      });

      if (result.success) {
        toast.success(`Cotización ${result.data.number} creada`);
        // Reset form
        setCounterpartName("");
        setCounterpartRif("");
        setValidUntil("");
        setNotes("");
        setItems([{ ...DEFAULT_ITEM }]);
        onSuccess?.(result.data.id, result.data.number);
      } else {
        toast.error(result.error);
      }
    });
  }

  const inputCls = "w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Tipo */}
      <div className="flex gap-4">
        {(["PURCHASE", "SALE"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="type"
              value={t}
              checked={type === t}
              onChange={() => setType(t)}
              className="accent-blue-600"
            />
            {t === "PURCHASE" ? "Cotización de Compra (COT)" : "Presupuesto de Venta (PRE)"}
          </label>
        ))}
      </div>

      {/* Contraparte + Divisa */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>Nombre de contraparte *</label>
          <input
            className={inputCls}
            value={counterpartName}
            onChange={(e) => setCounterpartName(e.target.value)}
            placeholder={type === "PURCHASE" ? "Proveedor S.A." : "Cliente C.A."}
            required
          />
        </div>
        <div>
          <label className={labelCls}>RIF contraparte</label>
          <input
            className={inputCls}
            value={counterpartRif}
            onChange={(e) => setCounterpartRif(e.target.value)}
            placeholder="J-12345678-9"
          />
        </div>
      </div>

      {/* Fecha validez + Divisa */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Válida hasta *</label>
          <input
            type="date"
            className={inputCls}
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Divisa</label>
          <select className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="VES">VES — Bolívares</option>
            <option value="USD">USD — Dólares</option>
            <option value="EUR">EUR — Euros</option>
          </select>
        </div>
      </div>

      {/* Ítems */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Ítems</span>
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-blue-600 hover:underline"
          >
            + Agregar ítem
          </button>
        </div>

        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                {idx === 0 && <label className={labelCls}>Descripción</label>}
                <input
                  className={inputCls}
                  value={item.description}
                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                  placeholder="Producto o servicio"
                  required
                />
              </div>
              <div className="col-span-1">
                {idx === 0 && <label className={labelCls}>Unidad</label>}
                <input
                  className={inputCls}
                  value={item.unit}
                  onChange={(e) => updateItem(idx, "unit", e.target.value)}
                  placeholder="und"
                  required
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>Cantidad</label>}
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  className={inputCls}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                  required
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>Precio unit.</label>}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className={inputCls}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>IVA</label>}
                <select
                  className={inputCls}
                  value={item.taxRate}
                  onChange={(e) => updateItem(idx, "taxRate", e.target.value)}
                >
                  {TAX_RATES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-1">
                {idx === 0 && <div className="mb-1 h-4" />}
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="w-full rounded border border-red-200 px-1 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notas */}
      <div>
        <label className={labelCls}>Notas (opcional)</label>
        <textarea
          className={inputCls + " resize-none"}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Condiciones, términos de entrega..."
          maxLength={500}
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Guardando…" : "Crear cotización"}
      </button>
    </form>
  );
}
