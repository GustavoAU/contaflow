"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { FixedAssetSummary } from "../services/FixedAssetService";
import {
  postMonthlyDepreciationAction,
  catchUpAssetDepreciationAction,
  catchUpAllAssetsDepreciationAction,
  postFixedAssetINPCRestatementAction,
  getFixedAssetGLReconciliationAction,
  type GLReconciliationResultRow,
} from "../actions/fixed-asset.actions";
import type { InpcRateSimple } from "../services/FixedAssetINPCService";
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

// Extensión del summary con campos calculados server-side (serialized)
type AssetRow = FixedAssetSummary & {
  acquisitionCost:         string;
  residualValue:           string;
  bookValue:               string;
  accumulatedDepreciation: string;
  // FC-01 INPC
  inpcFactor:              string | null;
  inpcReexpressedValue:    string | null;
  inpcAdjustment:          string | null;
  inpcCurrentPeriod:       string | null;
  inpcAcqRateMissing:      boolean;
};

type Props = {
  assets:         AssetRow[];
  companyId:      string;
  accounts:       AccountOption[];
  inpcRates:      InpcRateSimple[];   // para el selector del panel INPC
  ivaDFAccountId: string | null;      // IVA DF configurado en CompanySettings
};

export function FixedAssetList({ assets, companyId, accounts, inpcRates, ivaDFAccountId }: Props) {
  const [isPendingDepr, startDepr] = useTransition();
  const [deprYear, setDeprYear] = useState(new Date().getFullYear());
  const [deprMonth, setDeprMonth] = useState(new Date().getMonth() + 1);
  const [deprResult, setDeprResult] = useState<string | null>(null);
  const [scheduleAssetId, setScheduleAssetId] = useState<string | null>(null);
  const [disposeAsset, setDisposeAsset] = useState<FixedAssetSummary | null>(null);
  const [isPendingCatchUp, startCatchUp] = useTransition();
  const [isPendingCatchUpAll, startCatchUpAll] = useTransition();
  const [catchUpResult, setCatchUpResult] = useState<string | null>(null);

  // FC-01 INPC panel
  const latestRate    = inpcRates[0] ?? null;
  const [inpcYear,  setInpcYear]  = useState(latestRate?.year  ?? new Date().getFullYear());
  const [inpcMonth, setInpcMonth] = useState(latestRate?.month ?? new Date().getMonth() + 1);
  const [inpcPatrimonioAccId, setInpcPatrimonioAccId] = useState("");
  const [inpcResult, setInpcResult] = useState<string | null>(null);
  const [isPendingINPC, startINPC] = useTransition();

  const equityAccounts = accounts.filter((a) => a.type === "EQUITY");

  // FU-03: Conciliación GL
  const [glReconResult,   setGlReconResult]   = useState<GLReconciliationResultRow[] | null>(null);
  const [isPendingGLRecon, startGLRecon]       = useTransition();

  function handlePostDepreciation() {
    startDepr(async () => {
      const r = await postMonthlyDepreciationAction({ companyId, year: deprYear, month: deprMonth });
      if (r.success) {
        const { processed, skipped, errors } = r.data;
        const periodLabel = `${deprYear}/${String(deprMonth).padStart(2, "0")}`;
        if (processed === 0 && skipped > 0) {
          // FU-01: mensaje explícito cuando el período ya fue calculado
          toast.info(`El período ${periodLabel} ya fue calculado para todos los activos (${skipped} período${skipped !== 1 ? "s" : ""} existente${skipped !== 1 ? "s" : ""}). No se generaron nuevos asientos.`);
        } else if (processed > 0) {
          toast.success(`Depreciación ${periodLabel}: ${processed} activo${processed !== 1 ? "s" : ""} calculado${processed !== 1 ? "s" : ""}.`);
        } else {
          toast.info(`No hay activos activos que depreciar en ${periodLabel}.`);
        }
        setDeprResult(
          `${periodLabel}: ${processed} procesados, ${skipped} ya existían${errors.length ? `, ${errors.length} errores` : ""}.`,
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

  function handleINPCRestatement() {
    if (!inpcPatrimonioAccId) {
      toast.error("Selecciona la cuenta de Actualización de Patrimonio.");
      return;
    }
    setInpcResult(null);
    startINPC(async () => {
      const r = await postFixedAssetINPCRestatementAction({
        companyId,
        periodYear:          inpcYear,
        periodMonth:         inpcMonth,
        patrimonioAccountId: inpcPatrimonioAccId,
      });
      if (r.success) {
        const { processed, skipped, totalAdjustment } = r.data;
        if (processed === 0) {
          toast.info("No hay ajuste INPC pendiente (todos los activos ya ajustados o sin índice de adquisición).");
        } else {
          toast.success(`Reajuste INPC ${inpcYear}/${String(inpcMonth).padStart(2, "0")}: ${processed} activo${processed !== 1 ? "s" : ""} ajustado${processed !== 1 ? "s" : ""}.`);
        }
        setInpcResult(`${processed} ajustados · ${skipped} omitidos · Total Bs. ${totalAdjustment}`);
      } else {
        toast.error(r.error);
      }
    });
  }

  function handleGLReconciliation() {
    setGlReconResult(null);
    startGLRecon(async () => {
      const r = await getFixedAssetGLReconciliationAction(companyId);
      if (r.success) {
        setGlReconResult(r.data);
        const discrepancies = r.data.filter((row) => Math.abs(parseFloat(row.difference)) >= 0.01);
        if (discrepancies.length === 0) {
          toast.success(`Conciliación GL: ${r.data.length} cuenta${r.data.length !== 1 ? "s" : ""} cuadrada${r.data.length !== 1 ? "s" : ""} ✓`);
        } else {
          toast.warning(`${discrepancies.length} cuenta${discrepancies.length !== 1 ? "s" : ""} con diferencia GL. Revise el detalle abajo.`);
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

      {/* FC-01: Panel Reajuste por Inflación INPC (Art. 173 ISLR) */}
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-emerald-800">Reajuste por Inflación INPC</span>
          <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-800">Art. 173 ISLR</span>
          {latestRate === null && (
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              ⚠ No hay tasas INPC registradas
            </span>
          )}
        </div>
        {latestRate !== null ? (
          <>
            <p className="text-xs text-emerald-700">
              Último índice disponible: {MONTHS[latestRate.month - 1]} {latestRate.year} — los valores reexpresados aparecen en la columna &quot;Valor Reexpresado&quot; de la tabla.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Año del ajuste</label>
                <input
                  type="number"
                  value={inpcYear}
                  onChange={(e) => setInpcYear(parseInt(e.target.value))}
                  className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                  min={2020}
                  max={2100}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mes</label>
                <select
                  value={inpcMonth}
                  onChange={(e) => setInpcMonth(parseInt(e.target.value))}
                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cuenta Actualización de Patrimonio *</label>
                <select
                  value={inpcPatrimonioAccId}
                  onChange={(e) => setInpcPatrimonioAccId(e.target.value)}
                  className="min-w-48 rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="">Seleccionar cuenta EQUITY…</option>
                  {equityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleINPCRestatement}
                disabled={isPendingINPC || !inpcPatrimonioAccId}
                className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPendingINPC ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Calculando...
                  </span>
                ) : "Generar Reajuste INPC"}
              </button>
            </div>
            {inpcResult && (
              <p className="text-xs font-medium text-emerald-700">{inpcResult}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Para calcular el reajuste INPC, primero registra las tasas del índice en Configuración → Tasas INPC.
          </p>
        )}
      </div>

      {/* FU-03: Panel Conciliación GL vs. Módulo */}
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-violet-800">Conciliación GL vs. Módulo</span>
            <span className="rounded-full bg-violet-200 px-2 py-0.5 text-xs font-medium text-violet-800">Auditoría</span>
          </div>
          <button
            onClick={handleGLReconciliation}
            disabled={isPendingGLRecon}
            className="rounded bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {isPendingGLRecon ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Verificando...
              </span>
            ) : "Verificar conciliación"}
          </button>
        </div>
        <p className="text-xs text-violet-700">
          Compara los saldos de depreciación acumulada del módulo contra el Libro Mayor GL.
          Detecta asientos manuales o inconsistencias en las cuentas contables.
        </p>
        {glReconResult !== null && (
          glReconResult.length === 0 ? (
            <p className="text-xs font-medium text-emerald-700">✓ Sin activos registrados — nada que conciliar.</p>
          ) : (
            <div className="overflow-x-auto rounded border border-violet-200">
              <table className="w-full text-xs">
                <thead className="bg-violet-100">
                  <tr className="text-xs font-semibold uppercase text-violet-700">
                    <th className="px-3 py-2 text-left">Cuenta Dep. Acumulada</th>
                    <th className="px-3 py-2 text-right">Módulo</th>
                    <th className="px-3 py-2 text-right">GL</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    <th className="px-3 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-100">
                  {glReconResult.map((r) => {
                    const diff = parseFloat(r.difference);
                    const isBalanced = Math.abs(diff) < 0.01;
                    const isMinor    = !isBalanced && Math.abs(diff) < 1;
                    return (
                      <tr key={r.accDepreciationAccountId} className="bg-white hover:bg-violet-50/40">
                        <td className="px-3 py-2 text-gray-800">
                          <span className="font-medium">{r.accountCode}</span>
                          <span className="ml-1 text-gray-500">{r.accountName}</span>
                          <span className="ml-1 text-gray-400">
                            ({r.assetCount} activo{r.assetCount !== 1 ? "s" : ""})
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">
                          {formatAmount(r.moduleTotal)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">
                          {formatAmount(r.glTotal)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                          isBalanced ? "text-emerald-600" : isMinor ? "text-amber-600" : "text-red-600"
                        }`}>
                          {isBalanced ? "0.00" : formatAmount(r.difference)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isBalanced ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">✓ Cuadrado</span>
                          ) : isMinor ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">⚠ Menor</span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">✗ Descuadrado</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {glReconResult.length > 0 && (() => {
                  const bad = glReconResult.filter((r) => Math.abs(parseFloat(r.difference)) >= 0.01);
                  return (
                    <tfoot>
                      <tr className="border-t-2 border-violet-200 bg-violet-50">
                        <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-violet-700">
                          {bad.length === 0
                            ? "✓ Todas las cuentas cuadran con el GL"
                            : `⚠ ${bad.length} cuenta${bad.length !== 1 ? "s" : ""} con diferencia — revise asientos manuales`}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )
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
                <th scope="col" className="px-4 py-3 text-right">Valor Reexpresado</th>
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
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.name}</p>
                      {(a.internalCode || a.serialNumber) && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {a.internalCode && <span className="mr-2">#{a.internalCode}</span>}
                          {a.serialNumber && <span>S/N: {a.serialNumber}</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{METHOD_LABELS[a.depreciationMethod] ?? a.depreciationMethod}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-800">
                      {formatAmount(String(a.acquisitionCost))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">
                      {formatAmount(String(a.accumulatedDepreciation))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">
                      {formatAmount(String(a.bookValue))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {a.inpcAcqRateMissing ? (
                        <span className="text-amber-600" title="No hay índice INPC para el mes de adquisición">
                          Sin índice
                        </span>
                      ) : a.inpcReexpressedValue ? (
                        <span
                          className="font-medium text-emerald-700"
                          title={`Factor: ×${a.inpcFactor} | Ajuste: Bs. ${a.inpcAdjustment} | Período INPC: ${a.inpcCurrentPeriod}`}
                        >
                          {formatAmount(a.inpcReexpressedValue)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
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
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <button
                          onClick={() => setScheduleAssetId(a.id)}
                          className="whitespace-nowrap text-xs text-blue-600 hover:underline"
                        >
                          Tabla
                        </button>
                        {a.status === "ACTIVE" && (
                          <button
                            onClick={() => handleCatchUpAsset(a.id, a.name)}
                            disabled={isPendingCatchUp}
                            className="whitespace-nowrap text-xs text-indigo-600 hover:underline disabled:opacity-40"
                          >
                            Poner al día
                          </button>
                        )}
                        {a.status === "ACTIVE" && (
                          <button
                            onClick={() => handleDispose(a)}
                            className="whitespace-nowrap text-xs text-red-600 hover:underline"
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
          ivaDFAccountId={ivaDFAccountId}
          onClose={() => setDisposeAsset(null)}
        />
      )}
    </div>
  );
}
