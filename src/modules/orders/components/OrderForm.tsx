"use client";
// src/modules/orders/components/OrderForm.tsx
// Crear OC/OV — opcionalmente desde una cotización aprobada

import { useTransition, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { createOrderAction } from "../actions/order.actions";
import type { QuotationRow } from "../services/QuotationService";
import { ProductCombobox } from "./ProductCombobox";

interface Props {
  companyId: string;
  approvedQuotations: QuotationRow[];   // para el selector "desde cotización"
  onSuccess?: (id: string, number: string) => void;
}

const TAX_RATES = [
  { value: "0", label: "0% — Exento" },
  { value: "8", label: "8% — Reducido" },
  { value: "16", label: "16% — General" },
];

const DEFAULT_ITEM = { description: "", unit: "und", quantity: "1", unitPrice: "", taxRate: "16", stockQuantity: null as string | null };

export function OrderForm({ companyId, approvedQuotations, onSuccess }: Props) {
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<"PURCHASE" | "SALE">("PURCHASE");
  const [quotationId, setQuotationId] = useState("");
  const [counterpartName, setCounterpartName] = useState("");
  const [counterpartRif, setCounterpartRif] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [currency, setCurrency] = useState("VES");
  const [items, setItems] = useState([{ ...DEFAULT_ITEM }]);

  function handleQuotationSelect(qId: string) {
    setQuotationId(qId);
    if (!qId) return;
    const q = approvedQuotations.find((a) => a.id === qId);
    if (q) {
      setType(q.type);
      setCounterpartName(q.counterpartName);
      setCounterpartRif(q.counterpartRif ?? "");
      setCurrency(q.currency);
      setItems(
        q.items.map((i) => ({
          description: i.description,
          unit: i.unit,
          quantity: Number(i.quantity).toString(),
          unitPrice: Number(i.unitPrice).toString(),
          taxRate: Math.round(Number(i.taxRate)).toString() as "0" | "8" | "16",
          stockQuantity: null,
        }))
      );
    }
  }

  function addItem() {
    setItems((prev) => [...prev, { ...DEFAULT_ITEM }]);
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateItem(idx: number, field: string, value: string) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }
  function updateItemDescription(idx: number, description: string, unit?: string, stockQuantity?: string) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? { ...item, description, ...(unit !== undefined ? { unit } : {}), stockQuantity: stockQuantity ?? null }
          : item
      )
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createOrderAction(companyId, {
        type,
        quotationId: quotationId || undefined,
        counterpartName,
        counterpartRif: counterpartRif || undefined,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        currency,
        items,
      });

      if (result.success) {
        toast.success(`Orden ${result.data.number} creada`);
        setQuotationId("");
        setCounterpartName("");
        setCounterpartRif("");
        setExpectedDate("");
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

  const filteredQuotations = approvedQuotations.filter((q) => q.type === type);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Tipo */}
      <div className="flex gap-4">
        {(["PURCHASE", "SALE"] as const).map((t) => (
          <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              name="orderType"
              value={t}
              checked={type === t}
              onChange={() => { setType(t); setQuotationId(""); }}
              className="accent-blue-600"
            />
            {t === "PURCHASE" ? "Orden de Compra (OC)" : "Orden de Venta (OV)"}
          </label>
        ))}
      </div>

      {/* Cotización origen (opcional) */}
      {filteredQuotations.length > 0 && (
        <div>
          <label className={labelCls}>Desde cotización aprobada (opcional)</label>
          <select
            className={inputCls}
            value={quotationId}
            onChange={(e) => handleQuotationSelect(e.target.value)}
          >
            <option value="">— Sin cotización origen —</option>
            {filteredQuotations.map((q) => (
              <option key={q.id} value={q.id}>
                {q.number} — {q.counterpartName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Contraparte */}
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
          <label className={labelCls}>RIF</label>
          <input
            className={inputCls}
            value={counterpartRif}
            onChange={(e) => setCounterpartRif(e.target.value)}
            placeholder="J-12345678-9"
          />
        </div>
      </div>

      {/* Fecha + Divisa */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Fecha esperada de entrega</label>
          <input type="date" className={inputCls} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
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
          <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:underline">
            + Agregar ítem
          </button>
        </div>
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                {idx === 0 && <label className={labelCls}>Descripción{type === "SALE" ? " (buscar producto…)" : ""}</label>}
                {type === "SALE" ? (
                  <ProductCombobox
                    companyId={companyId}
                    value={item.description}
                    onChange={(desc, unit, stock) => updateItemDescription(idx, desc, unit, stock)}
                    inputCls={inputCls}
                    placeholder="Nombre o SKU…"
                    required
                  />
                ) : (
                  <input className={inputCls} value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} placeholder="Ítem" required />
                )}
              </div>
              <div className="col-span-1">
                {idx === 0 && <label className={labelCls}>Unidad</label>}
                <input className={inputCls} value={item.unit} onChange={(e) => updateItem(idx, "unit", e.target.value)} placeholder="und" required />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>Cantidad</label>}
                <input type="number" min="0.0001" step="0.0001" className={inputCls} value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} required />
                {type === "SALE" && item.stockQuantity !== null && (
                  <p className={`mt-0.5 text-[10px] font-mono ${parseFloat(item.stockQuantity) <= 0 ? "text-red-600" : parseFloat(item.stockQuantity) <= 5 ? "text-amber-600" : "text-green-700"}`}>
                    Stock: {parseFloat(item.stockQuantity).toFixed(2)}
                  </p>
                )}
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>Precio unit.</label>}
                <input type="number" min="0.01" step="0.01" className={inputCls} value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)} placeholder="0.00" required />
              </div>
              <div className="col-span-2">
                {idx === 0 && <label className={labelCls}>IVA</label>}
                <select className={inputCls} value={item.taxRate} onChange={(e) => updateItem(idx, "taxRate", e.target.value)}>
                  {TAX_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="col-span-1">
                {idx === 0 && <div className="mb-1 h-4" />}
                {items.length > 1 && (
                  <button type="button" onClick={() => removeItem(idx)} className="w-full rounded border border-red-200 px-1 py-1.5 text-xs text-red-600 hover:bg-red-50">×</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notas */}
      <div>
        <label className={labelCls}>Notas (opcional)</label>
        <textarea className={inputCls + " resize-none"} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condiciones, instrucciones..." maxLength={500} />
      </div>

      <button
        type="submit"
        disabled={isPending}
        aria-busy={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Guardando…" : `Crear ${type === "PURCHASE" ? "Orden de Compra" : "Orden de Venta"}`}
      </button>
    </form>
  );
}
