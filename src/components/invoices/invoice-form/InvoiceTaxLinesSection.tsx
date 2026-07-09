// src/components/invoices/invoice-form/InvoiceTaxLinesSection.tsx
// Presentacional — JSX movido MECÁNICAMENTE desde InvoiceForm.tsx (sin cambios).
// Estado y handlers viven en el contenedor; aquí solo llegan por props.
"use client";

import { formatCurrencyAmount } from "./helpers";
import type { TaxLine, TaxLineType } from "./types";

type Props = {
  taxLines: TaxLine[];
  taxCategory: string;
  currency: "VES" | "USD" | "EUR";
  totalIva: string;
  bcvLoading: boolean;
  bcvRate: { rate: string; date: string } | null;
  addTaxLine: () => void;
  removeTaxLine: (id: string) => void;
  updateTaxLine: (id: string, field: keyof TaxLine, value: string) => void;
  hasAdditionalWithoutGeneral: () => boolean;
};

export function InvoiceTaxLinesSection({
  taxLines,
  taxCategory,
  currency,
  totalIva,
  bcvLoading,
  bcvRate,
  addTaxLine,
  removeTaxLine,
  updateTaxLine,
  hasAdditionalWithoutGeneral,
}: Props) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-700">Desglose de Impuestos (IVA)</p>
        {(() => {
          const isBlocked = ["EXENTA", "EXONERADA", "NO_SUJETA"].includes(taxCategory);
          return (
            <button
              type="button"
              onClick={addTaxLine}
              disabled={isBlocked}
              title={isBlocked ? "No aplica para categoría fiscal seleccionada" : undefined}
              className={`text-sm font-medium ${
                isBlocked
                  ? "cursor-not-allowed text-zinc-400"
                  : "text-blue-600 hover:text-blue-800"
              }`}
            >
              + Agregar línea
            </button>
          );
        })()}
      </div>

      {/* Aviso bien suntuario */}
      {hasAdditionalWithoutGeneral() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ Falta la línea de <strong>IVA General (16%)</strong> requerida para bienes
          suntuarios. Agrégala sobre la misma base imponible.
        </div>
      )}

      {taxLines.map((line, idx) => (
        <div
          key={line.id}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
              Línea {idx + 1}
              {line.luxuryGroupId && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-10 font-bold text-amber-700 uppercase">
                  Bloque suntuario
                </span>
              )}
            </span>
            {(() => {
              // Slave IVA_GENERAL de un par suntuario: nunca mostrar eliminar —
              // se gestiona como bloque desde la línea IVA_ADICIONAL.
              if (line.taxType === "IVA_GENERAL" && line.luxuryGroupId) return null;

              // Calcular cuántas líneas quedarían tras eliminar
              const isLuxuryMaster = line.taxType === "IVA_ADICIONAL" && !!line.luxuryGroupId;
              const remaining = isLuxuryMaster
                ? taxLines.filter((l) => l.luxuryGroupId !== line.luxuryGroupId).length
                : taxLines.filter((l) => l.id !== line.id).length;

              if (remaining < 1) return null; // no dejar el form sin líneas

              return (
                <button
                  type="button"
                  onClick={() => removeTaxLine(line.id)}
                  className="text-xs font-medium text-red-400 hover:text-red-600"
                >
                  {isLuxuryMaster ? "Eliminar bloque" : "Eliminar"}
                </button>
              );
            })()}
          </div>

          {/* Tipo de impuesto */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Tipo de Impuesto
            </label>
            <select
              value={line.taxType}
              disabled={line.taxType === "IVA_GENERAL" && line.luxuryGroupId !== null}
              onChange={(e) =>
                updateTaxLine(line.id, "taxType", e.target.value as TaxLineType)
              }
              className="w-full rounded-md border bg-white px-3 py-2 text-sm font-medium text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
            >
              <option value="IVA_GENERAL">IVA General (16%)</option>
              <option value="IVA_REDUCIDO">IVA Reducido (8%)</option>
              <option value="IVA_ADICIONAL">IVA Lujo (15% Adicional)</option>
              <option value="EXENTO">Exento / Exonerado</option>
            </select>

            {line.taxType === "IVA_ADICIONAL" && (
              <p className="mt-1 rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                ⚠️ Esta línea calcula el 15% adicional. La línea de IVA General (16%) se
                gestionará automáticamente.
              </p>
            )}
          </div>

          {/* Glosa / descripción de la línea */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Glosa{" "}
              <span className="font-normal text-zinc-400" title="Prov. 00071: el libro debe identificar la naturaleza de la operación">(recomendada)</span>
            </label>
            <input
              type="text"
              value={line.description}
              onChange={(e) => updateTaxLine(line.id, "description", e.target.value)}
              placeholder="Ej: Venta de mercancías, Servicio de consultoría..."
              className="w-full rounded-md border px-3 py-2 text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Base + Tasa + Monto */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-600">
                Base Imponible
                {line.luxuryGroupId && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-10 font-bold text-amber-700 uppercase">
                    Vinculado
                  </span>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={line.base}
                disabled={line.taxType === "IVA_GENERAL" && !!line.luxuryGroupId}
                onChange={(e) => updateTaxLine(line.id, "base", e.target.value)}
                className="w-full rounded-md border px-3 py-2 font-mono text-sm text-zinc-800 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Tasa %</label>
              <input
                type="text"
                value={`${line.rate}%`}
                readOnly
                className="w-full cursor-not-allowed rounded-md border bg-zinc-100 px-3 py-2 text-center font-mono text-sm text-zinc-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Monto IVA
              </label>
              <input
                type="text"
                value={formatCurrencyAmount(line.amount, currency)}
                readOnly
                className="w-full rounded-md border bg-blue-50 px-3 py-2 text-right font-mono text-sm font-semibold text-blue-700"
              />
            </div>
          </div>
        </div>
      ))}

      {/* Total IVA */}
      <div className="flex justify-end border-t border-zinc-200 pt-2">
        <span className="mr-2 text-sm font-semibold text-zinc-600">Total IVA:</span>
        <span className="font-mono text-sm font-bold text-blue-700 tabular-nums">
          {formatCurrencyAmount(totalIva, currency)}
        </span>
      </div>
      {currency !== "VES" && (
        <div className="flex justify-end mt-1">
          <span className="text-xs text-zinc-500 tabular-nums">
            {bcvLoading ? (
              "Consultando tasa BCV..."
            ) : bcvRate ? (
              <>
                ≈ Bs.D{" "}
                {formatCurrencyAmount(
                  (parseFloat(totalIva) * parseFloat(bcvRate.rate)).toFixed(2),
                  "VES"
                ).replace("Bs.D ", "")}{" "}
                (tasa BCV: {parseFloat(bcvRate.rate).toLocaleString("es-VE", { minimumFractionDigits: 2 })})
              </>
            ) : (
              "Sin tasa BCV registrada para esta fecha"
            )}
          </span>
        </div>
      )}
    </div>
  );
}
