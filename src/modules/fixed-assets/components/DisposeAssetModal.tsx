"use client";
// src/modules/fixed-assets/components/DisposeAssetModal.tsx
// Modal para dar de baja un activo fijo con asiento GL cuadrado.
// Captura: motivo, fecha, precio de venta, cuenta de cobro, cuenta ganancia/pérdida.
// Muestra vista previa del asiento DEBE/HABER antes de confirmar.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { disposeFixedAssetAction } from "../actions/fixed-asset.actions";
import { DISPOSAL_REASONS, type DisposalReason } from "../schemas/fixed-asset.schema";
import { formatAmount } from "@/lib/format";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AccountOption = { id: string; code: string; name: string; type: string };

/** Versión serializada de FixedAssetSummary (Decimal → string) */
export type AssetInfo = {
  id:                     string;
  name:                   string;
  acquisitionCost:        string;
  accumulatedDepreciation: string;
  bookValue:              string;
};

type Props = {
  asset:     AssetInfo;
  companyId: string;
  accounts:  AccountOption[];
  onClose:   () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(n: number): string {
  return formatAmount(String(n));
}

const REASON_OPTS = Object.entries(DISPOSAL_REASONS).map(([value, label]) => ({
  value: value as DisposalReason,
  label,
}));

// ─── Componente ───────────────────────────────────────────────────────────────

export function DisposeAssetModal({ asset, companyId, accounts, onClose }: Props) {
  const [reason,         setReason]   = useState<DisposalReason>("OBSOLETE");
  const [disposalDate,   setDate]     = useState(todayISO);
  const [proceeds,       setProceeds] = useState("0");
  const [proceedsAccId,  setProAcc]   = useState("");
  const [glAccId,        setGlAccId]  = useState("");
  const [notes,          setNotes]    = useState("");
  const [formError,      setFormError] = useState<string | null>(null);
  const [isPending,      startT]      = useTransition();

  // ── Filtros de cuentas ────────────────────────────────────────────────────
  const assetAccounts  = accounts.filter((a) => a.type === "ASSET");
  const glAccounts     = accounts.filter((a) => a.type === "EXPENSE" || a.type === "REVENUE");

  // ── Cálculo en tiempo real ────────────────────────────────────────────────
  const cost       = parseFloat(asset.acquisitionCost)         || 0;
  const accDep     = parseFloat(asset.accumulatedDepreciation)  || 0;
  const bookVal    = parseFloat(asset.bookValue)                || 0;
  const procNum    = reason === "SALE" ? (parseFloat(proceeds) || 0) : 0;
  const gainLoss   = procNum - bookVal;          // + ganancia, − pérdida
  const isGain     = gainLoss > 0.01;
  const isLoss     = gainLoss < -0.01;
  const hasGainLoss = isGain || isLoss;

  // DEBE/HABER totales para el preview
  const debeTotal  = (accDep > 0.001 ? accDep : 0)
                   + (procNum > 0.001 ? procNum : 0)
                   + (isLoss ? Math.abs(gainLoss) : 0);
  const haberTotal = cost + (isGain ? gainLoss : 0);
  const isBalanced = Math.abs(debeTotal - haberTotal) < 0.02;

  // ── Validación ────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (reason === "SALE" && procNum > 0.001 && !proceedsAccId)
      return "Selecciona la cuenta bancaria o CxC donde se recibió el cobro.";
    if (hasGainLoss && !glAccId)
      return isGain
        ? "Selecciona la cuenta de ingreso por ganancia en venta."
        : "Selecciona la cuenta de pérdida en baja de activo.";
    return null;
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent | React.MouseEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setFormError(err); return; }
    setFormError(null);

    startT(async () => {
      const r = await disposeFixedAssetAction({
        assetId:           asset.id,
        companyId,
        reason,
        disposalDate:      new Date(disposalDate + "T12:00:00"),
        saleProceeds:      String(procNum),
        proceedsAccountId: proceedsAccId || null,
        gainLossAccountId: glAccId || null,
        notes:             notes || null,
      });
      if (r.success) {
        toast.success(`"${asset.name}" dado de baja correctamente.`);
        onClose();
      } else {
        setFormError(r.error);
      }
    });
  }

  // ── Estilos ────────────────────────────────────────────────────────────────
  const fc = "w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400";
  const lc = "block text-xs font-medium text-gray-600 mb-1";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Dar de baja activo</h2>
            <p className="text-sm text-gray-500 mt-0.5 truncate max-w-xs" title={asset.name}>
              {asset.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-4 shrink-0"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* ── Cuerpo (scrollable) ─────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

          {/* Resumen del activo */}
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-gray-50 p-3 text-center">
            <div>
              <p className="text-10 font-medium text-gray-400 uppercase tracking-wide">Costo Bs.</p>
              <p className="font-mono text-sm font-semibold text-gray-800 tabular-nums">
                {formatAmount(asset.acquisitionCost)}
              </p>
            </div>
            <div>
              <p className="text-10 font-medium text-gray-400 uppercase tracking-wide">Dep. Acum.</p>
              <p className="font-mono text-sm font-semibold text-orange-700 tabular-nums">
                {formatAmount(asset.accumulatedDepreciation)}
              </p>
            </div>
            <div>
              <p className="text-10 font-medium text-gray-400 uppercase tracking-wide">Valor Libros</p>
              <p className="font-mono text-sm font-bold text-gray-900 tabular-nums">
                {formatAmount(asset.bookValue)}
              </p>
            </div>
          </div>

          {/* Error */}
          {formError && (
            <p className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}

          {/* Motivo */}
          <div>
            <label className={lc}>Motivo de baja *</label>
            <select
              value={reason}
              onChange={(e) => { setReason(e.target.value as DisposalReason); setProceeds("0"); }}
              className={fc}
            >
              {REASON_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Fecha */}
          <div>
            <label className={lc}>Fecha de baja *</label>
            <input
              type="date"
              value={disposalDate}
              onChange={(e) => setDate(e.target.value)}
              required
              className={fc}
            />
          </div>

          {/* Precio de venta — solo SALE */}
          {reason === "SALE" && (
            <div>
              <label className={lc}>Precio de venta (Bs.)</label>
              <input
                type="number" step="0.01" min="0"
                value={proceeds}
                onChange={(e) => setProceeds(e.target.value)}
                className={fc}
                placeholder="0.00"
              />
            </div>
          )}

          {/* Cuenta de cobro — solo si hay precio > 0 */}
          {reason === "SALE" && procNum > 0.001 && (
            <div>
              <label className={lc}>Cuenta de cobro (Banco / CxC) *</label>
              <select
                value={proceedsAccId}
                onChange={(e) => setProAcc(e.target.value)}
                className={fc}
              >
                <option value="">Seleccionar cuenta ASSET…</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              <p className="mt-1 text-11 text-zinc-400">
                Cuenta donde se recibirá el dinero o se registra la CxC del comprador.
              </p>
            </div>
          )}

          {/* Cuenta ganancia/pérdida */}
          {hasGainLoss && (
            <div>
              <label className={lc}>
                {isGain ? "Cuenta de ganancia en venta *" : "Cuenta de pérdida en baja *"}
              </label>
              <select value={glAccId} onChange={(e) => setGlAccId(e.target.value)} className={fc}>
                <option value="">Seleccionar cuenta…</option>
                {glAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} ({a.type})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-11 text-zinc-400">
                {isGain
                  ? "Tipo REVENUE — ingreso por venta sobre el valor en libros."
                  : "Tipo EXPENSE — pérdida por baja o venta bajo valor en libros."}
              </p>
            </div>
          )}

          {/* ── Vista previa del asiento ──────────────────────────────────── */}
          <div className={`rounded-lg border p-3 ${isBalanced ? "border-blue-100 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
            <p className={`text-10 font-bold uppercase tracking-wide mb-2 ${isBalanced ? "text-blue-600" : "text-amber-700"}`}>
              Vista previa del asiento
            </p>
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className={`text-10 uppercase ${isBalanced ? "text-blue-500" : "text-amber-600"}`}>
                  <th className="text-left font-medium py-0.5">Concepto</th>
                  <th className="text-right font-medium py-0.5 w-28">Debe</th>
                  <th className="text-right font-medium py-0.5 w-28">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-100">
                {accDep > 0.001 && (
                  <tr>
                    <td className="py-1 text-gray-600">Dep. Acumulada</td>
                    <td className="py-1 text-right text-gray-900 tabular-nums">{fmt(accDep)}</td>
                    <td className="py-1 text-right text-gray-400">—</td>
                  </tr>
                )}
                {procNum > 0.001 && (
                  <tr>
                    <td className="py-1 text-gray-600">Banco / CxC (cobro)</td>
                    <td className="py-1 text-right text-gray-900 tabular-nums">{fmt(procNum)}</td>
                    <td className="py-1 text-right text-gray-400">—</td>
                  </tr>
                )}
                {isLoss && (
                  <tr>
                    <td className="py-1 text-red-600">Pérdida en baja</td>
                    <td className="py-1 text-right text-red-700 tabular-nums">{fmt(Math.abs(gainLoss))}</td>
                    <td className="py-1 text-right text-gray-400">—</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1 text-gray-600">Activo (costo histórico)</td>
                  <td className="py-1 text-right text-gray-400">—</td>
                  <td className="py-1 text-right text-gray-900 tabular-nums">{fmt(cost)}</td>
                </tr>
                {isGain && (
                  <tr>
                    <td className="py-1 text-emerald-600">Ganancia en venta</td>
                    <td className="py-1 text-right text-gray-400">—</td>
                    <td className="py-1 text-right text-emerald-700 tabular-nums">{fmt(gainLoss)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className={`border-t-2 font-bold text-10 ${isBalanced ? "border-blue-200 text-blue-800" : "border-amber-300 text-amber-800"}`}>
                  <td className="pt-1.5">Total</td>
                  <td className="pt-1.5 text-right tabular-nums">{fmt(debeTotal)}</td>
                  <td className="pt-1.5 text-right tabular-nums">{fmt(haberTotal)}</td>
                </tr>
                {!isBalanced && (
                  <tr>
                    <td colSpan={3} className="pt-1 text-xs text-amber-700 font-normal">
                      ⚠ Asiento descuadrado — completa los campos requeridos arriba.
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {/* Notas */}
          <div>
            <label className={lc}>Notas (opcional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              className={`${fc} resize-none`}
              placeholder="Ej: Vendido a Empresa ABC, factura 00234…"
            />
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between gap-3">
          <p className="text-11 text-zinc-400 leading-snug">
            Esta acción genera un asiento irreversible en el Libro Diario.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              aria-busy={isPending}
              className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isPending ? "Procesando…" : "Confirmar baja"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
