"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { FixedAssetSummary } from "../services/FixedAssetService";
import { postMonthlyDepreciationAction, disposeFixedAssetAction } from "../actions/fixed-asset.actions";
import { DepreciationScheduleModal } from "./DepreciationScheduleModal";

const METHOD_LABELS: Record<string, string> = {
  LINEA_RECTA: "Línea Recta",
  SUMA_DIGITOS: "Suma de Dígitos",
  UNIDADES_PRODUCCION: "Unidades de Producción",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Activo", className: "bg-green-100 text-green-800" },
  DISPOSED: { label: "Baja", className: "bg-red-100 text-red-800" },
  FULLY_DEPRECIATED: { label: "Depreciado", className: "bg-gray-100 text-gray-700" },
};

type Props = {
  assets: FixedAssetSummary[];
  companyId: string;
};

export function FixedAssetList({ assets, companyId }: Props) {
  const [isPendingDepr, startDepr] = useTransition();
  const [deprYear, setDeprYear] = useState(new Date().getFullYear());
  const [deprMonth, setDeprMonth] = useState(new Date().getMonth() + 1);
  const [deprResult, setDeprResult] = useState<string | null>(null);
  const [scheduleAssetId, setScheduleAssetId] = useState<string | null>(null);
  const [isPendingDispose, startDispose] = useTransition();

  function handlePostDepreciation() {
    startDepr(async () => {
      const r = await postMonthlyDepreciationAction({ companyId, year: deprYear, month: deprMonth });
      if (r.success) {
        setDeprResult(
          `Depreciación ${deprYear}/${String(deprMonth).padStart(2, "0")}: ${r.data.processed} procesados, ${r.data.skipped} ya calculados${r.data.errors.length ? `, ${r.data.errors.length} errores` : ""}.`,
        );
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleDispose(assetId: string, assetName: string) {
    if (!confirm(`¿Dar de baja el activo "${assetName}"? Esta acción generará un asiento contable de baja.`)) return;
    startDispose(async () => {
      const r = await disposeFixedAssetAction({
        assetId,
        companyId,
        disposalDate: new Date(),
        saleProceeds: "0",
      });
      if (r.success) toast.success(`Activo "${assetName}" dado de baja correctamente`);
      else toast.error(r.error);
    });
  }

  const MONTHS = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
  ];

  return (
    <div className="space-y-4">
      {/* Panel depreciación mensual masiva */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Año</label>
          <input
            type="number"
            value={deprYear}
            onChange={(e) => setDeprYear(parseInt(e.target.value))}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
            min={2020}
            max={2100}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mes</label>
          <select
            value={deprMonth}
            onChange={(e) => setDeprMonth(parseInt(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handlePostDepreciation}
          disabled={isPendingDepr}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPendingDepr ? "Calculando..." : "Calcular Depreciación del Mes"}
        </button>
        {deprResult && (
          <p className="text-xs text-blue-700">{deprResult}</p>
        )}
      </div>

      {/* Tabla de activos */}
      {assets.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-8">No hay activos fijos registrados.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Método</th>
                <th className="px-4 py-3 text-right">Costo</th>
                <th className="px-4 py-3 text-right">Dep. Acumulada</th>
                <th className="px-4 py-3 text-right">Valor en Libros</th>
                <th className="px-4 py-3 text-left">Último Período</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assets.map((a) => {
                const statusInfo = STATUS_LABELS[a.status] ?? { label: a.status, className: "bg-gray-100 text-gray-600" };
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-3 text-gray-600">{METHOD_LABELS[a.depreciationMethod] ?? a.depreciationMethod}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-800">
                      {a.acquisitionCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-orange-700">
                      {a.accumulatedDepreciation.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {a.bookValue.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {a.lastEntryDate
                        ? `${a.lastEntryDate.year}/${String(a.lastEntryDate.month).padStart(2, "0")}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => setScheduleAssetId(a.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Tabla
                        </button>
                        {a.status === "ACTIVE" && (
                          <button
                            onClick={() => handleDispose(a.id, a.name)}
                            disabled={isPendingDispose}
                            className="text-xs text-red-600 hover:underline disabled:opacity-40"
                          >
                            Dar de baja
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal tabla de depreciación */}
      {scheduleAssetId && (
        <DepreciationScheduleModal
          assetId={scheduleAssetId}
          companyId={companyId}
          onClose={() => setScheduleAssetId(null)}
        />
      )}
    </div>
  );
}
