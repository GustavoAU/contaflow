"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { previewInflationAdjustmentAction, runInflationAdjustmentAction } from "../actions/inpc.actions";
import type { SerializedPreviewRow, SerializedRepomo } from "../actions/inpc.actions";
import type { Account } from "@prisma/client";

const MONTHS = [
  "","Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function fmt(v: string | number, decimals = 2): string {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(typeof v === "string" ? parseFloat(v) : v);
}

type Props = {
  companyId: string;
  equityAccounts: Pick<Account, "id" | "code" | "name">[];
  repomoAccounts: Pick<Account, "id" | "code" | "name">[];
  inflationBaseYear: number | null;
  inflationBaseMonth: number | null;
};

export function InflationAdjustmentPanel({
  companyId,
  equityAccounts,
  repomoAccounts,
  inflationBaseYear,
  inflationBaseMonth,
}: Props) {
  const now = new Date();
  const [periodYear, setPeriodYear]   = useState(now.getFullYear());
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [adjustmentAccountId, setAdjustmentAccountId] = useState(equityAccounts[0]?.id ?? "");
  const [repomoAccountId, setRepomoAccountId] = useState(repomoAccounts[0]?.id ?? "");

  const [previewRows, setPreviewRows]       = useState<SerializedPreviewRow[] | null>(null);
  const [previewRepomo, setPreviewRepomo]   = useState<SerializedRepomo | null>(null);
  const [previewError, setPreviewError]     = useState<string | null>(null);
  const [runResult, setRunResult]           = useState<string | null>(null);
  const [runError, setRunError]             = useState<string | null>(null);
  const [showConfirm, setShowConfirm]       = useState(false);

  const [isPendingPreview, startPreview] = useTransition();
  const [isPendingRun, startRun]         = useTransition();

  const baseLabel = inflationBaseYear
    ? `${MONTHS[inflationBaseMonth ?? 1]} ${inflationBaseYear}`
    : "No configurado";

  function handlePreview() {
    setPreviewError(null);
    setPreviewRows(null);
    setPreviewRepomo(null);
    setRunResult(null);
    setRunError(null);
    setShowConfirm(false);

    startPreview(async () => {
      const r = await previewInflationAdjustmentAction({
        companyId,
        periodYear,
        periodMonth,
        adjustmentAccountId,
        repomoAccountId: repomoAccountId || undefined,
      });
      if (r.success) {
        setPreviewRows(r.data.rows);
        setPreviewRepomo(r.data.repomo);
      } else {
        setPreviewError(r.error);
      }
    });
  }

  function handleConfirmRun() {
    setRunError(null);
    setShowConfirm(false);
    startRun(async () => {
      const r = await runInflationAdjustmentAction({
        companyId,
        periodYear,
        periodMonth,
        adjustmentAccountId,
        repomoAccountId: repomoAccountId || undefined,
      });
      if (r.success) {
        const repomoMsg = r.data.repomo
          ? `, REPOMO: Bs. ${r.data.repomo}`
          : "";
        setRunResult(
          `Ajuste registrado: ${r.data.adjustedAccounts} cuentas, total Bs. ${fmt(r.data.totalAdjustment)}, factor ${fmt(r.data.factor, 4)}${repomoMsg}.`,
        );
        setPreviewRows(null);
        setPreviewRepomo(null);
      } else {
        setRunError(r.error);
      }
    });
  }

  const totalAdjustment = previewRows
    ? previewRows.reduce((acc, r) => acc + Math.abs(parseFloat(r.adjustmentAmount)), 0)
    : null;

  const hasPreview = previewRows !== null;
  const hasRows = hasPreview && (previewRows.length > 0 || previewRepomo !== null);

  return (
    <div className="space-y-4">
      {/* Parámetros del ajuste */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-indigo-700 uppercase">Período base:</span>
          <span className="text-xs text-indigo-600">{baseLabel}</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Año a ajustar</label>
            <input
              type="number"
              value={periodYear}
              onChange={(e) => setPeriodYear(parseInt(e.target.value))}
              min={2000} max={2100}
              className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Mes a ajustar</label>
            <select
              value={periodMonth}
              onChange={(e) => setPeriodMonth(parseInt(e.target.value))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {MONTHS.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cuenta actualizadora</label>
            <select
              value={adjustmentAccountId}
              onChange={(e) => setAdjustmentAccountId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-48"
            >
              {equityAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          {repomoAccounts.length > 0 && (
            <div>
              <label
                className="block text-xs font-medium text-gray-600 mb-1 cursor-help"
                title="Cuenta que registra el Resultado por Posición Monetaria Neta (VEN-NIF 3 §36.4)"
              >
                Cuenta REPOMO ⓘ
              </label>
              <select
                value={repomoAccountId}
                onChange={(e) => setRepomoAccountId(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-48"
              >
                <option value="">— Sin REPOMO —</option>
                {repomoAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={handlePreview}
            disabled={isPendingPreview || !adjustmentAccountId}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPendingPreview && <Loader2Icon className="animate-spin" />}{isPendingPreview ? "Calculando..." : "Vista Previa"}
          </button>
        </div>

        {repomoAccounts.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            No hay cuentas de Ingreso/Gasto disponibles para registrar el REPOMO. Crea una cuenta de tipo
            REVENUE o EXPENSE para el resultado por inflación.
          </p>
        )}

        {previewError && <p className="text-xs text-red-600">{previewError}</p>}
      </div>

      {/* Vista previa de asientos */}
      {hasPreview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">
              Asientos proyectados — {MONTHS[periodMonth]} {periodYear}
            </h3>
            {hasRows && totalAdjustment !== null && (
              <span className="text-xs text-gray-500">
                Total reexpresión: <span className="font-mono font-semibold">{fmt(totalAdjustment)}</span>
              </span>
            )}
          </div>

          {!hasRows ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No hay cuentas con saldo en el período especificado.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Cuenta</th>
                      <th className="px-4 py-2 text-left">Tipo</th>
                      <th className="px-4 py-2 text-right">Saldo Actual</th>
                      <th
                        className="px-4 py-2 text-right cursor-help"
                        title="Factor = INPC del período ÷ INPC del período base"
                      >
                        Factor ⓘ
                      </th>
                      <th className="px-4 py-2 text-right">Ajuste</th>
                      <th className="px-4 py-2 text-right">Saldo Reexp.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((row) => {
                      const reexpressed = parseFloat(row.originalBalance) + parseFloat(row.adjustmentAmount);
                      return (
                        <tr key={row.accountId} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <span className="font-mono text-xs text-gray-500">{row.accountCode}</span>{" "}
                            <span className="text-gray-900">{row.accountName}</span>
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">{row.accountType}</td>
                          <td className="px-4 py-2 text-right font-mono text-gray-700">
                            {fmt(row.originalBalance)}
                          </td>
                          <td
                            className="px-4 py-2 text-right font-mono text-gray-500 cursor-help"
                            title={`${row.periodInpc} ÷ ${row.baseInpc} = ${parseFloat(row.cumulativeIndex).toFixed(6)}`}
                          >
                            {fmt(row.cumulativeIndex, 4)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${parseFloat(row.adjustmentAmount) > 0 ? "text-green-700" : "text-red-700"}`}>
                            {fmt(row.adjustmentAmount)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-indigo-700">
                            {fmt(reexpressed)}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Fila REPOMO — VEN-NIF 3 §36.4 */}
                    {previewRepomo && (
                      <tr className="bg-amber-50 border-t-2 border-amber-200">
                        <td className="px-4 py-2" colSpan={2}>
                          <span className="font-medium text-amber-800">REPOMO</span>{" "}
                          <span className="text-xs text-amber-600">
                            (PMN: {fmt(previewRepomo.netMonetaryPosition)}) × (factor − 1)
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">
                          {fmt(previewRepomo.netMonetaryPosition)}
                        </td>
                        <td
                          className="px-4 py-2 text-right font-mono text-gray-500 cursor-help"
                          title={`Factor = ${parseFloat(previewRepomo.factor).toFixed(6)}`}
                        >
                          {fmt(previewRepomo.factor, 4)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono font-semibold ${parseFloat(previewRepomo.repomoAmount) > 0 ? "text-red-700" : "text-green-700"}`}>
                          {fmt(previewRepomo.repomoAmount)}
                          <span className="ml-1 text-xs font-normal">
                            {parseFloat(previewRepomo.repomoAmount) > 0 ? "(pérdida)" : "(ganancia)"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-amber-600">
                          {repomoAccountId ? "se registra" : "sin cuenta REPOMO"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Botón confirmar */}
              {!showConfirm ? (
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={isPendingRun}
                  className="rounded bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Confirmar y Registrar Ajuste
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
                  <p className="text-sm text-yellow-800 font-medium flex-1">
                    ¿Registrar el ajuste por inflación? Esta acción genera un asiento contable irreversible (solo anulable por VOID).
                  </p>
                  <button
                    onClick={handleConfirmRun}
                    disabled={isPendingRun}
                    className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {isPendingRun && <Loader2Icon className="animate-spin" />}{isPendingRun ? "Registrando..." : "Confirmar"}
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Resultado del ajuste */}
      {runResult && (
        <div className="rounded bg-green-100 px-4 py-2 text-sm font-medium text-green-800">
          {runResult}
        </div>
      )}
      {runError && (
        <div className="rounded bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
          {runError}
        </div>
      )}
    </div>
  );
}
