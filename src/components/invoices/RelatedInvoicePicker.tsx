"use client";

// src/components/invoices/RelatedInvoicePicker.tsx
// Picker buscable para seleccionar la FACTURA original al crear NC/ND.

import { useState, useRef, useEffect, useTransition } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import {
  searchInvoicesForPickerAction,
  type InvoicePickerItem,
} from "@/modules/invoices/actions/invoice.actions";

type Props = {
  companyId: string;
  type: "SALE" | "PURCHASE";
  value: string;           // ID seleccionado
  onChange: (id: string) => void;
};

function fmt(val: string | null): string {
  if (!val) return "";
  return Number(val).toLocaleString("es-VE", { minimumFractionDigits: 2 });
}

export function RelatedInvoicePicker({ companyId, type, value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvoicePickerItem[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<InvoicePickerItem | null>(null);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cerrar al click fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Limpiar selección si el padre resetea el valor
  useEffect(() => {
    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(null);
      setQuery("");
    }
  }, [value]);

  function handleQueryChange(q: string) {
    setQuery(q);
    setOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchInvoicesForPickerAction(companyId, type, q);
        if (r.success) setResults(r.data);
      });
    }, 300);
  }

  function handleSelect(item: InvoicePickerItem) {
    setSelected(item);
    onChange(item.id);
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function handleClear() {
    setSelected(null);
    onChange("");
    setQuery("");
    setResults([]);
  }

  function handleFocus() {
    // Cargar resultados vacíos (últimas 10) al abrir sin query
    setOpen(true);
    if (!query && results.length === 0) {
      startTransition(async () => {
        const r = await searchInvoicesForPickerAction(companyId, type, "");
        if (r.success) setResults(r.data);
      });
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* ─── Selección activa ────────────────────────────────────────────── */}
      {selected ? (
        <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-blue-900">{selected.invoiceNumber}</p>
            <p className="truncate text-xs text-blue-700">
              {selected.counterpartName}
              {selected.totalAmountVes && (
                <span className="ml-2 font-mono">Bs. {fmt(selected.totalAmountVes)}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 rounded p-0.5 text-blue-500 hover:text-blue-700"
            aria-label="Limpiar selección"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        /* ─── Input de búsqueda ──────────────────────────────────────────── */
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={handleFocus}
            placeholder="Buscar por RIF, número o nombre del cliente/proveedor..."
            className="w-full rounded-md border py-2 pl-9 pr-9 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        </div>
      )}

      {/* ─── Dropdown de resultados ───────────────────────────────────────── */}
      {open && !selected && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-white shadow-lg">
          {isPending && (
            <p className="px-4 py-3 text-xs text-zinc-400">Buscando...</p>
          )}
          {!isPending && results.length === 0 && (
            <p className="px-4 py-3 text-xs text-zinc-400">
              {query ? "Sin resultados" : "Sin facturas disponibles"}
            </p>
          )}
          {!isPending && results.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 border-b last:border-b-0 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900">{item.invoiceNumber}</p>
                <p className="truncate text-xs text-zinc-500">
                  {item.counterpartName}
                  {item.counterpartRif && (
                    <span className="ml-1 font-mono text-zinc-400">{item.counterpartRif}</span>
                  )}
                  <span className="mx-1 text-zinc-300">·</span>
                  {item.date}
                  {item.totalAmountVes && (
                    <>
                      <span className="mx-1 text-zinc-300">·</span>
                      <span className="font-mono">Bs. {fmt(item.totalAmountVes)}</span>
                    </>
                  )}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
