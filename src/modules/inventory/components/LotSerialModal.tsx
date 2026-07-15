"use client";

// src/modules/inventory/components/LotSerialModal.tsx
// Modal de contabilización para ítems con seguimiento LOT o SERIAL.
// Renderiza uno de 4 formularios según trackingType × movementType:
//   LOT  + ENTRADA  → datos del lote (lotNumber, expiresAt, notes)
//   LOT  + SALIDA   → editor de asignaciones FEFO (editable)
//   SERIAL + ENTRADA → captura de números de serie (textarea, 1 por línea)
//   SERIAL + SALIDA  → selector de seriales AVAILABLE

import { useEffect, useState } from "react";
import {
  getAvailableLotsAction,
  getAvailableSerialsAction,
} from "../actions/inventory-accounting.actions";
import type { PendingMovement } from "./PendingMovementsList";

// ─── Types ────────────────────────────────────────────────────────────────────

type AvailableLot = {
  id: string;
  lotNumber: string;
  quantityOnHand: string;
  expiresAt: string | null;
};

type AvailableSerial = {
  id: string;
  serialNumber: string;
};

type LotAllocation = {
  lotId: string;
  lotNumber: string;
  available: string;
  quantity: string;
};

export type LotSerialInput =
  | { lotData: { lotNumber: string; expiresAt?: string | null; notes?: string | null; receivedAt?: string | null } }
  | { lotAllocations: Array<{ lotId: string; quantity: string }> }
  | { serialNumbers: string[] }
  | { serialIds: string[] };

type Props = {
  movement: PendingMovement;
  companyId: string;
  onClose: () => void;
  onConfirm: (data: LotSerialInput) => void;
  isSubmitting: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeFefo(lots: AvailableLot[], required: number): LotAllocation[] {
  const result: LotAllocation[] = [];
  let remaining = required;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const avail = parseFloat(lot.quantityOnHand);
    const take = Math.min(avail, remaining);
    result.push({
      lotId: lot.id,
      lotNumber: lot.lotNumber,
      available: lot.quantityOnHand,
      quantity: take.toFixed(4).replace(/\.?0+$/, "") || "0",
    });
    remaining = parseFloat((remaining - take).toFixed(10));
  }
  return result;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Sin vencimiento";
  return new Date(iso).toLocaleDateString("es-VE", { timeZone: "UTC" });
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LotSerialModal({ movement, companyId, onClose, onConfirm, isSubmitting }: Props) {
  const trackingType = movement.item.trackingType;
  const movType = movement.type as "ENTRADA" | "SALIDA" | "AJUSTE";
  const requiredQty = parseFloat(movement.quantity);

  // ── LOT ENTRADA state ──
  const [lotNumber, setLotNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [lotNotes, setLotNotes] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  // ── LOT SALIDA state ──
  const [availableLots, setAvailableLots] = useState<AvailableLot[]>([]);
  const [allocations, setAllocations] = useState<LotAllocation[]>([]);
  const [lotsLoading, setLotsLoading] = useState(trackingType === "LOT" && movType !== "ENTRADA");
  const [lotsError, setLotsError] = useState<string | null>(null);

  // ── SERIAL ENTRADA state ──
  const [serialInput, setSerialInput] = useState("");

  // ── SERIAL SALIDA state ──
  const [availableSerials, setAvailableSerials] = useState<AvailableSerial[]>([]);
  const [selectedSerialIds, setSelectedSerialIds] = useState<string[]>([]);
  const [serialsLoading, setSerialsLoading] = useState(trackingType === "SERIAL" && movType !== "ENTRADA");
  const [serialsError, setSerialsError] = useState<string | null>(null);
  const [serialSearch, setSerialSearch] = useState("");

  // ── Fetch data on mount ──
  useEffect(() => {
    if (trackingType === "LOT" && movType !== "ENTRADA") {
      getAvailableLotsAction(companyId, movement.item.id).then((r) => {
        setLotsLoading(false);
        if (r.success) {
          setAvailableLots(r.data);
          setAllocations(computeFefo(r.data, requiredQty));
        } else {
          setLotsError(r.error);
        }
      });
    } else if (trackingType === "SERIAL" && movType !== "ENTRADA") {
      getAvailableSerialsAction(companyId, movement.item.id).then((r) => {
        setSerialsLoading(false);
        if (r.success) {
          setAvailableSerials(r.data);
        } else {
          setSerialsError(r.error);
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived validation ──
  const allocationTotal = allocations.reduce((s, a) => s + parseFloat(a.quantity || "0"), 0);
  const allocationOk = Math.abs(allocationTotal - requiredQty) < 0.0001;

  const parsedSerials = serialInput
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const uniqueSerials = [...new Set(parsedSerials)];
  const serialEntradaOk = uniqueSerials.length === requiredQty;

  const serialSalidaOk = selectedSerialIds.length === Math.round(requiredQty);

  // ── Confirm handler ──
  function handleConfirm() {
    if (trackingType === "LOT" && movType === "ENTRADA") {
      if (!lotNumber.trim()) return;
      onConfirm({
        lotData: {
          lotNumber: lotNumber.trim(),
          expiresAt: expiresAt || null,
          notes: lotNotes.trim() || null,
          receivedAt: receivedAt || null,
        },
      });
    } else if (trackingType === "LOT") {
      if (!allocationOk) return;
      onConfirm({
        lotAllocations: allocations
          .filter((a) => parseFloat(a.quantity || "0") > 0)
          .map((a) => ({ lotId: a.lotId, quantity: a.quantity })),
      });
    } else if (trackingType === "SERIAL" && movType === "ENTRADA") {
      if (!serialEntradaOk) return;
      onConfirm({ serialNumbers: uniqueSerials });
    } else {
      if (!serialSalidaOk) return;
      onConfirm({ serialIds: selectedSerialIds });
    }
  }

  function toggleSerial(id: string) {
    setSelectedSerialIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function updateAllocation(lotId: string, value: string) {
    setAllocations((prev) =>
      prev.map((a) => (a.lotId === lotId ? { ...a, quantity: value } : a))
    );
  }

  const filteredSerials = availableSerials.filter((s) =>
    s.serialNumber.toLowerCase().includes(serialSearch.toLowerCase())
  );

  const canConfirm =
    !isSubmitting &&
    (trackingType === "LOT" && movType === "ENTRADA"
      ? !!lotNumber.trim()
      : trackingType === "LOT"
      ? allocationOk
      : trackingType === "SERIAL" && movType === "ENTRADA"
      ? serialEntradaOk
      : serialSalidaOk);

  const typeLabel = movType === "ENTRADA" ? "Entrada" : movType === "SALIDA" ? "Salida" : "Ajuste";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Contabilizar — {movement.item.name}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {typeLabel} · {trackingType === "LOT" ? "Seguimiento por lote" : "Seguimiento por número de serie"} · {parseFloat(movement.quantity).toLocaleString("es-VE", { maximumFractionDigits: 4 })} {movement.item.unit}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* ── LOT ENTRADA ─────────────────────────────────────────────── */}
          {trackingType === "LOT" && movType === "ENTRADA" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de lote <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Ej. LOTE-2026-001"
                  maxLength={100}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Si el lote ya existe, se sumará la cantidad al stock existente.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de vencimiento
                  <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={expiresAt ? expiresAt.split("T")[0] : ""}
                  onChange={(e) =>
                    setExpiresAt(e.target.value ? new Date(e.target.value).toISOString() : "")
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fecha de recepción
                  <span className="ml-1 text-xs font-normal text-gray-400">(opcional, por defecto hoy)</span>
                </label>
                <input
                  type="date"
                  value={receivedAt ? receivedAt.split("T")[0] : ""}
                  onChange={(e) =>
                    setReceivedAt(e.target.value ? new Date(e.target.value).toISOString() : "")
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notas del lote
                  <span className="ml-1 text-xs font-normal text-gray-400">(opcional)</span>
                </label>
                <textarea
                  value={lotNotes}
                  onChange={(e) => setLotNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Proveedor, condiciones de almacenamiento, etc."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {/* ── LOT SALIDA (FEFO editor) ─────────────────────────────────── */}
          {trackingType === "LOT" && movType !== "ENTRADA" && (
            <>
              {lotsLoading && (
                <p className="text-sm text-gray-500 text-center py-4">Cargando lotes disponibles...</p>
              )}
              {lotsError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{lotsError}</p>
              )}
              {!lotsLoading && !lotsError && availableLots.length === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                  No hay lotes con stock disponible para este producto.
                </p>
              )}
              {!lotsLoading && !lotsError && availableLots.length > 0 && (
                <>
                  <p className="text-xs text-gray-500">
                    Asignación FEFO automática (editable). Los lotes se ordenan por fecha de vencimiento más próxima primero.
                  </p>
                  <div className="rounded-lg border border-gray-200 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left">Lote</th>
                          <th scope="col" className="px-3 py-2 text-left">Vence</th>
                          <th scope="col" className="px-3 py-2 text-right">Disponible</th>
                          <th scope="col" className="px-3 py-2 text-right">Asignar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {allocations.map((alloc) => (
                          <tr key={alloc.lotId} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-gray-800">{alloc.lotNumber}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {formatDate(availableLots.find((l) => l.id === alloc.lotId)?.expiresAt ?? null)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">
                              {parseFloat(alloc.available).toLocaleString("es-VE", { maximumFractionDigits: 4 })}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                max={alloc.available}
                                step="0.0001"
                                value={alloc.quantity}
                                onChange={(e) => updateAllocation(alloc.lotId, e.target.value)}
                                className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-xs font-mono focus:border-blue-500 focus:outline-none"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={`text-xs font-medium text-right ${allocationOk ? "text-green-600" : "text-red-600"}`}>
                    Total asignado: {allocationTotal.toLocaleString("es-VE", { maximumFractionDigits: 4 })} / {requiredQty.toLocaleString("es-VE", { maximumFractionDigits: 4 })} {movement.item.unit}
                    {!allocationOk && " — debe coincidir exactamente"}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── SERIAL ENTRADA ───────────────────────────────────────────── */}
          {trackingType === "SERIAL" && movType === "ENTRADA" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Números de serie
                  <span className="ml-1 text-xs font-normal text-gray-400">(uno por línea)</span>
                </label>
                <textarea
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  rows={6}
                  placeholder={"SN-001\nSN-002\nSN-003"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className={`text-xs font-medium ${serialEntradaOk ? "text-green-600" : "text-gray-500"}`}>
                {uniqueSerials.length} serie(s) ingresada(s) — se requieren {Math.round(requiredQty)}
                {parsedSerials.length !== uniqueSerials.length && (
                  <span className="ml-2 text-amber-600">
                    ({parsedSerials.length - uniqueSerials.length} duplicado(s) ignorado(s))
                  </span>
                )}
              </div>
              {uniqueSerials.length > 0 && (
                <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 max-h-32 overflow-y-auto">
                  {uniqueSerials.map((s) => (
                    <div key={s} className="text-xs font-mono text-gray-600">{s}</div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── SERIAL SALIDA ────────────────────────────────────────────── */}
          {trackingType === "SERIAL" && movType !== "ENTRADA" && (
            <>
              {serialsLoading && (
                <p className="text-sm text-gray-500 text-center py-4">Cargando seriales disponibles...</p>
              )}
              {serialsError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{serialsError}</p>
              )}
              {!serialsLoading && !serialsError && availableSerials.length === 0 && (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                  No hay números de serie disponibles para este producto.
                </p>
              )}
              {!serialsLoading && !serialsError && availableSerials.length > 0 && (
                <>
                  <div className={`text-xs font-medium ${serialSalidaOk ? "text-green-600" : "text-gray-500"}`}>
                    {selectedSerialIds.length} seleccionado(s) de {Math.round(requiredQty)} requerido(s)
                  </div>
                  <input
                    type="text"
                    value={serialSearch}
                    onChange={(e) => setSerialSearch(e.target.value)}
                    placeholder="Buscar número de serie..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="rounded-lg border border-gray-200 max-h-52 overflow-y-auto divide-y divide-gray-100">
                    {filteredSerials.map((s) => {
                      const checked = selectedSerialIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSerial(s.id)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          />
                          <span className="text-sm font-mono text-gray-800">{s.serialNumber}</span>
                        </label>
                      );
                    })}
                    {filteredSerials.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">Sin resultados</p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Contabilizando...
              </span>
            ) : (
              "Contabilizar"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
