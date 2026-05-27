"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { FixedAssetSummary } from "../services/FixedAssetService";
import {
  postMonthlyDepreciationAction,
  catchUpAssetDepreciationAction,
  catchUpAllAssetsDepreciationAction,
} from "../actions/fixed-asset.actions";
import { DepreciationScheduleModal } from "./DepreciationScheduleModal";
import { DisposeAssetModal, type AccountOption } from "./DisposeAssetModal";
import { formatAmount } from "@/lib/format";

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

// AF-39: meses restantes de vida útil para activos ACTIVE basados en tiempo
// Retorna null si no aplica (DISPOSED, FULLY_DEPRECIATED, UNIDADES_PRODUCCION)
function getMonthsRemaining(a: FixedAssetSummary): number | null {
  if (a.status !== "ACTIVE") return null;
  if (a.depreciationMethod === "UNIDADES_PRODUCCION") return null;
  if (!a.lastEntryDate) return a.usefulLifeMonths;
  const acqDate = new Date(a.acquisitionDate);
  const acqYear = acqDate.getUTCFullYear();
  const acqMonth = acqDate.getUTCMonth() + 1;
  const monthsDepreciated =
    (a.lastEntryDate.year - acqYear) * 12 + (a.lastEntryDate.month - acqMonth);
  return Math.max(0, a.usefulLifeMonths - monthsDepreciated);
}

type Props = {
  assets:    FixedAssetSummary[];
  companyId: string;
  accounts:  AccountOption[];
};

export function FixedAssetList({ assets, companyId, accounts }: Props) {
  const [isPendingDepr, startDepr] = useTransition();
  const [deprYear, setDeprYear] = useState(new Date().getFullYear());
  const [deprMonth, setDeprMonth] = useState(new Date().getMonth() + 1);
  const [deprResult, setDeprResult] = useState<string | null>(null);
  const [scheduleAssetId, setScheduleAssetId] = useState<string | null>(null);
  const [disposeAsset, setDisposeAsset] = useState<FixedAssetSummary | null>(null);
  const [isPendingCatchUp, startCatchUp] = useTransition();
  const [isPendingCatchUpAll, startCatchUpAll] = useTransition();
  const [catchUpResult, setCatchUpResult] = useState<string | null>(null);

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

  function handleDispose(asset: FixedAssetSummary) {
    setDisposeAsset(asset);
  }

  function handleCatchUpAsset(assetId: string, assetName: string) {
    setCatchUpResult(null);
    startCatchUp(async () => {
      const r = await catchUpAssetDepreciationAction({ assetId, companyId });
      if (r.success) {
        const { processed, skipped, errors, noPeriods, nextPeriodLabel } = r.data;
        if (noPeriods) {
          toast.info(`"${assetName}": aún no tiene períodos depreciables. El primer período será ${nextPeriodLabel}.`);
        } else if (processed === 0 && skipped > 0) {
          toast.info(`"${assetName}" ya está al día — ${skipped} período${skipped !== 1 ? "s" : ""} ya registrado${skipped !== 1 ? "s" : ""}.`);
        } else if (processed > 0) {
          toast.success(`"${assetName}": ${processed} período${processed !== 1 ? "s" : ""} calculado${processed !== 1 ? "s" : ""}${skipped > 0 ? `, ${skipped} ya existían` : ""}.`);
        }
        if (errors.length > 0) {
          toast.warning(`${errors.length} advertencia${errors.length !== 1 ? "s" : ""}: ${errors[0]}`);
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleCatchUpAll() {
    setCatchUpResult(null);
    startCatchUpAll(async () => {
      const r = await catchUpAllAssetsDepreciationAction({ companyId });
      if (r.success) {
        const { totalProcessed, totalSkipped, assetErrors } = r.data;
        const errorCount = Object.keys(assetErrors).length;
        if (totalProcessed > 0) {
          toast.success(`${totalProcessed} período${totalProcessed !== 1 ? "s" : ""} de depreciación calculado${totalProcessed !== 1 ? "s" : ""} correctamente.`);
        } else if (totalSkipped > 0) {
          toast.info("Todos los activos ya están al día.");
        } else {
          toast.info("No hay activos con períodos depreciables pendientes.");
        }
        const msg = [
          totalProcessed > 0 ? `${totalProcessed} período${totalProcessed !== 1 ? "s" : ""} calculado${totalProcessed !== 1 ? "s" : ""}` : null,
          totalSkipped > 0 ? `${totalSkipped} ya existían` : null,
          errorCount > 0 ? `${errorCount} activo${errorCount !== 1 ? "s" : ""} con advertencias` : null,
        ].filter(Boolean).join(" · ");
        setCatchUpResult(msg || "Sin cambios.");
        if (errorCount > 0) {
          const firstAsset = Object.keys(assetErrors)[0]!;
          toast.warning(`${firstAsset}: ${assetErrors[firstAsset]![0]}`);
        }
      } else {
        toast.error(r.error);
      }
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
          {isPendingDepr ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Calculando...
            </span>
          ) : "Calcular Depreciación del Mes"}
        </button>
        {deprResult && (
          <p className="text-xs text-blue-700">{deprResult}</p>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleCatchUpAll}
            disabled={isPendingCatchUpAll}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPendingCatchUpAll ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Calculando...
              </span>
            ) : "Calcular todos al día"}
          </button>
        </div>
        {catchUpResult && (
          <p className="w-full text-xs text-indigo-700">{catchUpResult}</p>
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
                <th scope="col" className="px-4 py-3 text-left">Nombre</th>
                <th scope="col" className="px-4 py-3 text-left">Método</th>
                <th scope="col" className="px-4 py-3 text-right">Costo</th>
                <th scope="col" className="px-4 py-3 text-right">Dep. Acumulada</th>
                <th scope="col" className="px-4 py-3 text-right">Valor en Libros</th>
                <th scope="col" className="px-4 py-3 text-left">Último Período</th>
                <th scope="col" className="px-4 py-3 text-center">Estado</th>
                <th scope="col" className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assets.map((a) => {
                const statusInfo = STATUS_LABELS[a.status] ?? { label: a.status, className: "bg-gray-100 text-gray-600" };
                const monthsLeft = getMonthsRemaining(a);
                const showAlert = monthsLeft !== null && monthsLeft <= 3;
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-3 text-gray-600">{METHOD_LABELS[a.depreciationMethod] ?? a.depreciationMethod}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-800">
                      {formatAmount(String(a.acquisitionCost))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-orange-700">
                      {formatAmount(String(a.accumulatedDepreciation))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {formatAmount(String(a.bookValue))}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {a.lastEntryDate
                        ? `${a.lastEntryDate.year}/${String(a.lastEntryDate.month).padStart(2, "0")}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        {showAlert && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              monthsLeft === 0
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                            title={`Quedan ${monthsLeft} mes${monthsLeft !== 1 ? "es" : ""} de vida útil`}
                          >
                            {monthsLeft === 0
                              ? "Vida útil agotada"
                              : `Vence en ${monthsLeft} mes${monthsLeft !== 1 ? "es" : ""}`}
                          </span>
                        )}
                      </div>
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
                            onClick={() => handleCatchUpAsset(a.id, a.name)}
                            disabled={isPendingCatchUp}
                            className="text-xs text-indigo-600 hover:underline disabled:opacity-40"
                          >
                            Poner al día
                          </button>
                        )}
                        {a.status === "ACTIVE" && (
                          <button
                            onClick={() => handleDispose(a)}
                            className="text-xs text-red-600 hover:underline"
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

      {/* Modal dar de baja */}
      {disposeAsset && (
        <DisposeAssetModal
          asset={{
            id:                      disposeAsset.id,
            name:                    disposeAsset.name,
            acquisitionCost:         String(disposeAsset.acquisitionCost),
            accumulatedDepreciation: String(disposeAsset.accumulatedDepreciation),
            bookValue:               String(disposeAsset.bookValue),
          }}
          companyId={companyId}
          accounts={accounts}
          onClose={() => setDisposeAsset(null)}
        />
      )}
    </div>
  );
}
