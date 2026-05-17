// @vitest-environment jsdom
// src/modules/bank-reconciliation/components/AutoReconciliationPanel.tsx
"use client";

import { useReducer, useTransition, useRef, useState } from "react";
import {
  UploadIcon,
  FileTextIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  XCircleIcon,
  CheckIcon,
  XIcon,
  Loader2Icon,
} from "lucide-react";
import { parseBankStatementAction, runAutoReconciliationAction, confirmSuggestedAction } from "../actions/auto-reconciliation.actions";
import type {
  ExtractedBankStatement,
  AutoReconciliationResult,
  AutoMatchResult,
} from "../schemas/auto-reconciliation.schema";
import { fmtVen } from "@/lib/fmt-ven";

// ─── State machine ────────────────────────────────────────────────────────────

type PanelState =
  | { step: "UPLOAD"; error: string | null }
  | { step: "PREVIEW"; extracted: ExtractedBankStatement; balanceError: string | null }
  | { step: "RUNNING" }
  | { step: "RESULTS"; results: AutoReconciliationResult; pending: Map<string, { matchType: string; matchId: string }> }
  | { step: "CONFIRMED"; confirmed: number };

type PanelAction =
  | { type: "UPLOAD_ERROR"; error: string }
  | { type: "PARSED"; extracted: ExtractedBankStatement; balanceError: string | null }
  | { type: "RUN" }
  | { type: "RESULTS"; results: AutoReconciliationResult }
  | { type: "TOGGLE_CONFIRM"; row: AutoMatchResult }
  | { type: "CONFIRMED"; confirmed: number }
  | { type: "RESET" };

function reducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "UPLOAD_ERROR":
      return { step: "UPLOAD", error: action.error };
    case "PARSED":
      return { step: "PREVIEW", extracted: action.extracted, balanceError: action.balanceError };
    case "RUN":
      return { step: "RUNNING" };
    case "RESULTS":
      return { step: "RESULTS", results: action.results, pending: new Map() };
    case "TOGGLE_CONFIRM": {
      if (state.step !== "RESULTS") return state;
      const key = action.row.description + "|" + action.row.amount;
      const next = new Map(state.pending);
      if (next.has(key)) {
        next.delete(key);
      } else if (action.row.matchType && action.row.matchId) {
        next.set(key, { matchType: action.row.matchType, matchId: action.row.matchId });
      }
      return { ...state, pending: next };
    }
    case "CONFIRMED":
      return { step: "CONFIRMED", confirmed: action.confirmed };
    case "RESET":
      return { step: "UPLOAD", error: null };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(value: string): string {
  return fmtVen(value);
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  bankAccountId: string;
  bankAccountName: string;
  companyId: string;
};

export function AutoReconciliationPanel({ bankAccountId, bankAccountName, companyId }: Props) {
  const [state, dispatch] = useReducer(reducer, { step: "UPLOAD", error: null });
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchVal, setSearchVal] = useState("");

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      dispatch({ type: "UPLOAD_ERROR", error: "El archivo supera el límite de 10 MB" });
      return;
    }

    if (file.type !== "application/pdf") {
      dispatch({ type: "UPLOAD_ERROR", error: "Solo se aceptan archivos PDF" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:application/pdf;base64," prefix
      const base64 = dataUrl.split(",")[1];
      if (!base64) {
        dispatch({ type: "UPLOAD_ERROR", error: "No se pudo leer el archivo" });
        return;
      }

      startTransition(async () => {
        const result = await parseBankStatementAction({ companyId, base64Pdf: base64 });
        if (!result.success) {
          dispatch({ type: "UPLOAD_ERROR", error: result.error });
          return;
        }
        // Validar balance (openingBalance + credits - debits = closingBalance)
        let balanceError: string | null = null;
        const ob = parseFloat((result.data.openingBalance ?? "0").replace(/\./g, "").replace(",", "."));
        const cb = parseFloat((result.data.closingBalance ?? "0").replace(/\./g, "").replace(",", "."));
        if (!isNaN(ob) && !isNaN(cb) && result.data.rows.length > 0) {
          let computed = ob;
          for (const r of result.data.rows) {
            if (r.credit) computed += parseFloat(r.credit.replace(/\./g, "").replace(",", ".")) || 0;
            if (r.debit) computed -= parseFloat(r.debit.replace(/\./g, "").replace(",", ".")) || 0;
          }
          const diff = Math.abs(computed - cb);
          if (diff > 0.02) {
            balanceError = `El saldo calculado (${computed.toFixed(2)}) no coincide con el saldo final declarado (${cb.toFixed(2)})`;
          }
        }
        dispatch({ type: "PARSED", extracted: result.data, balanceError });
      });
    };
    reader.readAsDataURL(file);
  }

  function handleRunReconciliation() {
    if (state.step !== "PREVIEW") return;
    startTransition(async () => {
      dispatch({ type: "RUN" });
      const result = await runAutoReconciliationAction({
        companyId,
        bankAccountId,
        rows: state.extracted.rows,
        openingBalance: state.extracted.openingBalance ?? "0",
        closingBalance: state.extracted.closingBalance ?? "0",
      });
      if (!result.success) {
        dispatch({ type: "UPLOAD_ERROR", error: result.error });
        return;
      }
      dispatch({ type: "RESULTS", results: result.data });
    });
  }

  function handleConfirmAll() {
    if (state.step !== "RESULTS") return;
    if (state.pending.size === 0) return;

    const confirmations = Array.from(state.pending.values()).map((v) => ({
      bankTransactionId: "", // Se completará con el ID real tras el import
      matchType: v.matchType as "INVOICE_PAYMENT" | "JOURNAL_ENTRY" | "PAYMENT_RECORD",
      matchId: v.matchId,
    }));

    startTransition(async () => {
      const result = await confirmSuggestedAction({ companyId, confirmations });
      if (result.success) {
        dispatch({ type: "CONFIRMED", confirmed: result.data.confirmed });
      }
    });
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (state.step === "CONFIRMED") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircleIcon className="mx-auto mb-3 h-8 w-8 text-green-500" />
        <h3 className="font-semibold text-green-900">Conciliación completada</h3>
        <p className="mt-1 text-sm text-green-700">
          {state.confirmed} movimiento{state.confirmed !== 1 ? "s" : ""} confirmado{state.confirmed !== 1 ? "s" : ""} correctamente.
        </p>
        <button
          onClick={() => dispatch({ type: "RESET" })}
          className="mt-4 rounded-md border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-50"
        >
          Nueva conciliación
        </button>
      </div>
    );
  }

  if (state.step === "RUNNING") {
    return (
      <div className="rounded-lg border bg-white p-8 text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
        <p className="text-sm font-medium text-zinc-700">Analizando movimientos...</p>
        <p className="mt-1 text-xs text-zinc-400">Comparando con pagos y facturas del sistema</p>
      </div>
    );
  }

  if (state.step === "RESULTS") {
    const { results } = state;

    if (!results.periodHasData) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <h3 className="font-semibold text-amber-900">Conciliación no disponible</h3>
              <p className="mt-1 text-sm text-amber-800">
                El período seleccionado no tiene transacciones registradas en ContaFlow.
                Registra los pagos o facturas del período antes de iniciar la conciliación.
              </p>
              <button
                onClick={() => dispatch({ type: "RESET" })}
                className="mt-3 text-sm font-medium text-amber-900 underline hover:no-underline"
              >
                Volver
              </button>
            </div>
          </div>
        </div>
      );
    }

    const filteredSuggested = results.suggested.filter((r) =>
      searchVal === "" ||
      r.description.toLowerCase().includes(searchVal.toLowerCase()) ||
      (r.reference ?? "").toLowerCase().includes(searchVal.toLowerCase())
    );

    return (
      <div className="space-y-4">
        {/* Filtro de búsqueda */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            placeholder="Buscar por descripción o referencia..."
            className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-sm text-zinc-500">{results.totalRows} movimientos analizados</span>
        </div>

        {/* AUTO */}
        <ResultSection
          title="Auto-conciliados"
          count={results.auto.length}
          icon={<CheckCircleIcon className="h-4 w-4 text-green-600" />}
          headerClass="bg-green-50 border-green-200 text-green-800"
          defaultOpen={false}
          rows={results.auto}
          showConfirm={false}
        />

        {/* SUGGESTED */}
        <ResultSection
          title="Sugeridos — requieren confirmación"
          count={filteredSuggested.length}
          icon={<AlertCircleIcon className="h-4 w-4 text-amber-600" />}
          headerClass="bg-amber-50 border-amber-200 text-amber-800"
          defaultOpen={true}
          rows={filteredSuggested}
          showConfirm={true}
          pending={state.pending}
          onToggle={(row) => dispatch({ type: "TOGGLE_CONFIRM", row })}
        />

        {/* UNMATCHED */}
        <ResultSection
          title="Sin conciliar"
          count={results.unmatched.length}
          icon={<XCircleIcon className="h-4 w-4 text-red-600" />}
          headerClass="bg-red-50 border-red-200 text-red-800"
          defaultOpen={true}
          rows={results.unmatched}
          showConfirm={false}
        />

        {/* Acción batch */}
        {state.pending.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm font-medium text-blue-800">
              {state.pending.size} coincidencia{state.pending.size !== 1 ? "s" : ""} seleccionada{state.pending.size !== 1 ? "s" : ""}
            </p>
            <button
              onClick={handleConfirmAll}
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Confirmando..." : "Confirmar seleccionadas"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (state.step === "PREVIEW") {
    const { extracted, balanceError } = state;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-900">Vista previa del extracto</h3>
              {extracted.bankName && (
                <p className="text-xs text-zinc-500">
                  {extracted.bankName}
                  {extracted.accountNumber ? ` — ${extracted.accountNumber}` : ""}
                  {extracted.holderName ? ` — ${extracted.holderName}` : ""}
                </p>
              )}
            </div>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {extracted.rows.length} movimientos
            </span>
          </div>

          {balanceError && (
            <div className="mb-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{balanceError}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b bg-zinc-50 text-left text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Descripción</th>
                  <th className="px-3 py-2">Referencia</th>
                  <th className="px-3 py-2 text-right">Débito</th>
                  <th className="px-3 py-2 text-right">Crédito</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {extracted.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="hover:bg-zinc-50">
                    <td className="px-3 py-2 font-mono text-zinc-600">{row.date}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-zinc-800">{row.description}</td>
                    <td className="px-3 py-2 font-mono text-zinc-500">{row.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">
                      {row.debit ? fmtAmount(row.debit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-600">
                      {row.credit ? fmtAmount(row.credit) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-600">
                      {row.balance ? fmtAmount(row.balance) : "—"}
                    </td>
                  </tr>
                ))}
                {extracted.rows.length > 10 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-center text-zinc-400">
                      ... y {extracted.rows.length - 10} más
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleRunReconciliation}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <CheckCircleIcon className="h-4 w-4" />
              {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Procesando..." : "Iniciar conciliación automática"}
            </button>
            <button
              onClick={() => dispatch({ type: "RESET" })}
              disabled={isPending}
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // UPLOAD step
  return (
    <div className="rounded-lg border bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <FileTextIcon className="h-5 w-5 text-zinc-400" />
        <h3 className="font-medium text-zinc-900">Importar extracto bancario — {bankAccountName}</h3>
      </div>

      <div
        className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center transition-colors hover:border-blue-400 hover:bg-blue-50"
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadIcon className="mb-3 h-8 w-8 text-zinc-400" />
        <p className="text-sm font-medium text-zinc-700">Sube el extracto bancario en PDF</p>
        <p className="mt-1 text-xs text-zinc-400">
          Compatible con BNC, Banesco, Mercantil, Provincial, BDV — máx. 10 MB
        </p>
        <button
          type="button"
          disabled={isPending}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending && <Loader2Icon className="animate-spin" />}{isPending ? "Analizando PDF..." : "Seleccionar PDF"}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      {state.error && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <XCircleIcon className="h-4 w-4 flex-shrink-0" />
          {state.error}
        </div>
      )}
    </div>
  );
}

// ─── ResultSection sub-component ─────────────────────────────────────────────

type ResultSectionProps = {
  title: string;
  count: number;
  icon: React.ReactNode;
  headerClass: string;
  defaultOpen: boolean;
  rows: AutoMatchResult[];
  showConfirm: boolean;
  pending?: Map<string, { matchType: string; matchId: string }>;
  onToggle?: (row: AutoMatchResult) => void;
};

function ResultSection({
  title,
  count,
  icon,
  headerClass,
  defaultOpen,
  rows,
  showConfirm,
  pending,
  onToggle,
}: ResultSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        onClick={() => setOpen((o: boolean) => !o)}
        className={`flex w-full items-center justify-between px-4 py-3 text-left ${headerClass} border-b`}
      >
        <div className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </div>
        <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold">
          {count}
        </span>
      </button>

      {open && (
        <div className="divide-y bg-white">
          {rows.map((row, i) => {
            const key = row.description + "|" + row.amount;
            const isSelected = pending?.has(key) ?? false;

            return (
              <div key={i} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium ${
                          row.type === "CREDIT"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {row.type === "CREDIT" ? "Crédito" : "Débito"}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">{row.date}</span>
                      {row.reference && (
                        <span className="font-mono text-xs text-zinc-400">ref: {row.reference}</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-800">{row.description}</p>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-900">
                      {fmtAmount(row.amount)} VES
                    </p>
                    {row.matchLabel && (
                      <p className="mt-1 text-xs text-zinc-500">
                        → {row.matchLabel}
                        {row.matchAmount && ` (${fmtAmount(row.matchAmount)} VES)`}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-zinc-400">{row.reason}</p>
                  </div>

                  {showConfirm && onToggle && row.matchId && (
                    <button
                      onClick={() => onToggle(row)}
                      className={`flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        isSelected
                          ? "bg-green-600 text-white hover:bg-green-700"
                          : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {isSelected ? (
                        <span className="flex items-center gap-1">
                          <CheckIcon className="h-3 w-3" /> Confirmado
                        </span>
                      ) : (
                        "Confirmar"
                      )}
                    </button>
                  )}

                  {showConfirm && onToggle && !row.matchId && (
                    <span className="flex-shrink-0 rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-400">
                      <XIcon className="inline h-3 w-3" /> Sin match
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
