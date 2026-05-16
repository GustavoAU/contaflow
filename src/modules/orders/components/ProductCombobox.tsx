"use client";
// src/modules/orders/components/ProductCombobox.tsx
// Selector opcional de producto del inventario para ítems de OV.
// Si el usuario escribe sin seleccionar, el texto queda como descripción libre.

import { useState, useRef, useEffect, useCallback } from "react";
import { searchInventoryItemsAction } from "@/modules/inventory/actions/inventory-operations.actions";
import Decimal from "decimal.js";

interface InventoryHit {
  id: string;
  name: string;
  sku: string;
  stockQuantity: string;
  baseUnitAbbr: string;
}

interface Props {
  companyId: string;
  value: string;
  onChange: (description: string, unit?: string, stockQuantity?: string) => void;
  inputCls: string;
  placeholder?: string;
  required?: boolean;
}

export function ProductCombobox({ companyId, value, onChange, inputCls, placeholder, required }: Props) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<InventoryHit[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync external reset (e.g., form clear)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const search = useCallback(
    (q: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (q.length < 2) { setResults([]); setOpen(false); return; }
      timerRef.current = setTimeout(async () => {
        const r = await searchInventoryItemsAction(companyId, q);
        if (r.success && r.data.length > 0) {
          setResults(r.data);
          setOpen(true);
        } else {
          setResults([]);
          setOpen(false);
        }
      }, 300);
    },
    [companyId]
  );

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v); // free-text passthrough
    search(v);
  }

  function handleSelect(hit: InventoryHit) {
    setQuery(hit.name);
    setOpen(false);
    setResults([]);
    onChange(hit.name, hit.baseUnitAbbr, hit.stockQuantity);
  }

  const stockColor = (qty: string) => {
    const n = new Decimal(qty);
    if (n.lte(0)) return "bg-red-100 text-red-700";
    if (n.lte(5)) return "bg-amber-100 text-amber-700";
    return "bg-green-100 text-green-700";
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        className={inputCls}
        value={query}
        onChange={handleInput}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg text-xs max-h-52 overflow-y-auto">
          {results.map((hit) => (
            <li
              key={hit.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(hit); }}
              className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-blue-50 cursor-pointer"
            >
              <span className="truncate">
                <span className="font-medium text-gray-900">{hit.name}</span>
                <span className="ml-1 text-gray-400">({hit.sku})</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono ${stockColor(hit.stockQuantity)}`}>
                {new Decimal(hit.stockQuantity).toFixed(2)} {hit.baseUnitAbbr}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
