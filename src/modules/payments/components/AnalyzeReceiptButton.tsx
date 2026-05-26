"use client";

// src/modules/payments/components/AnalyzeReceiptButton.tsx
// ADR-030 D-4 — Botón "Analizar con IA" sobre comprobante adjunto (Gemini 2.0 Flash)
// Extrae campos del comprobante bancario venezolano para asistir el registro de pagos.

import { useState, useTransition } from "react";
import { SparklesIcon, Loader2Icon, CheckCircleIcon, AlertTriangleIcon } from "lucide-react";
import { analyzeReceiptAction, type ReceiptAnalysisResult } from "../actions/payment.actions";

type Props = {
  companyId: string;
  attachmentId: string;
  /** Callback que recibe los datos extraídos para pre-llenar el formulario */
  onAnalyzed?: (data: ReceiptAnalysisResult) => void;
};

export function AnalyzeReceiptButton({ companyId, attachmentId, onAnalyzed }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ReceiptAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function handleAnalyze() {
    setError(null);
    setResult(null);
    setExpanded(false);
    startTransition(async () => {
      const res = await analyzeReceiptAction(companyId, attachmentId);
      if (res.success) {
        setResult(res.data);
        setExpanded(true);
        onAnalyzed?.(res.data);
      } else {
        setError(res.error);
      }
    });
  }

  const confidenceColor =
    result && result.confidence >= 0.85
      ? "text-green-700"
      : result
        ? "text-amber-700"
        : "";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleAnalyze}
        disabled={isPending}
        aria-busy={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <SparklesIcon className="size-3.5" />
        )}
        {isPending ? "Analizando..." : "Analizar con IA"}
      </button>

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {result && expanded && (
        <div className="rounded-md border border-violet-100 bg-white p-3 text-xs shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-zinc-700">Datos extraídos por IA</span>
            <span className={`flex items-center gap-1 ${confidenceColor}`}>
              {result.confidence >= 0.85 ? (
                <CheckCircleIcon className="size-3.5" />
              ) : (
                <AlertTriangleIcon className="size-3.5" />
              )}
              Confianza: {Math.round(result.confidence * 100)}%
            </span>
          </div>
          {result.confidence < 0.85 && (
            <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-amber-700">
              ⚠️ Confianza baja — verifique los datos antes de usar
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {result.method && (
              <><span className="text-zinc-400">Método:</span><span className="font-medium">{result.method}</span></>
            )}
            {result.amount && (
              <><span className="text-zinc-400">Monto:</span><span className="font-mono font-medium">{result.amount} {result.currency ?? ""}</span></>
            )}
            {result.referenceNumber && (
              <><span className="text-zinc-400">Referencia:</span><span className="font-mono">{result.referenceNumber}</span></>
            )}
            {result.date && (
              <><span className="text-zinc-400">Fecha:</span><span className="font-mono">{result.date}</span></>
            )}
            {result.originBank && (
              <><span className="text-zinc-400">Banco origen:</span><span>{result.originBank}</span></>
            )}
            {result.destBank && (
              <><span className="text-zinc-400">Banco destino:</span><span>{result.destBank}</span></>
            )}
            {result.senderPhone && (
              <><span className="text-zinc-400">Tel. emisor:</span><span className="font-mono">{result.senderPhone}</span></>
            )}
            {result.destPhone && (
              <><span className="text-zinc-400">Tel. receptor:</span><span className="font-mono">{result.destPhone}</span></>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-2 text-xs text-zinc-400 hover:text-zinc-600"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
