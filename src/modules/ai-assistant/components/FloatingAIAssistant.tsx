"use client";
// src/modules/ai-assistant/components/FloatingAIAssistant.tsx
//
// Botón flotante persistent + panel lateral con ContaFlow IA.
// - Badge rojo/ámbar si FiscalAnomalyDetectorService detecta anomalías.
// - Sugerencia contextual al abrir cuando hay anomalías críticas o altas.
// - Accesible: focus-trap manual, aria-expanded, role="dialog".

import { useEffect, useRef, useState, useTransition } from "react";
import { SparklesIcon, XIcon, AlertTriangleIcon, ShieldAlertIcon } from "lucide-react";
import { getAnomalySummaryAction } from "../actions/ai-assistant.actions";
import { AIAssistantChat } from "./AIAssistantChat";

type Props = {
  companyId: string;
  companyName: string;
};

type AnomalyState =
  | { status: "loading" }
  | { status: "clean" }
  | { status: "critical"; count: number }
  | { status: "high"; count: number }
  | { status: "error" };

export function FloatingAIAssistant({ companyId, companyName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [anomaly, setAnomaly] = useState<AnomalyState>({ status: "loading" });
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // ─── Fetch anomaly summary on mount ─────────────────────────────────────────
  useEffect(() => {
    startTransition(async () => {
      const result = await getAnomalySummaryAction(companyId);
      if (!result.success) {
        setAnomaly({ status: "error" });
        return;
      }
      if (result.critical > 0) {
        setAnomaly({ status: "critical", count: result.critical });
      } else if (result.high > 0) {
        setAnomaly({ status: "high", count: result.high });
      } else {
        setAnomaly({ status: "clean" });
      }
    });
  }, [companyId]);

  // ─── Keyboard: Escape cierra el panel ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // ─── Focus panel on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      // pequeño delay para que la transición CSS inicie primero
      const t = setTimeout(() => panelRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // ─── Derivados ────────────────────────────────────────────────────────────────
  const badgeCount =
    anomaly.status === "critical"
      ? anomaly.count
      : anomaly.status === "high"
        ? anomaly.count
        : 0;

  const badgeColor =
    anomaly.status === "critical"
      ? "bg-red-500"
      : anomaly.status === "high"
        ? "bg-amber-500"
        : "";

  const contextualChip =
    anomaly.status === "critical"
      ? `⚠️ ${anomaly.count} anomalía${anomaly.count > 1 ? "s" : ""} crítica${anomaly.count > 1 ? "s" : ""} detectada${anomaly.count > 1 ? "s" : ""} — auditarlas ahora`
      : anomaly.status === "high"
        ? `🔶 ${anomaly.count} anomalía${anomaly.count > 1 ? "s" : ""} de importancia detectada${anomaly.count > 1 ? "s" : ""}`
        : null;

  return (
    <>
      {/* ── Overlay ─────────────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* ── Panel lateral ───────────────────────────────────────────────────── */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Asistente ContaFlow IA"
        tabIndex={-1}
        className={[
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl outline-none",
          "transition-transform duration-300 ease-in-out",
          "dark:bg-zinc-900",
          "sm:w-[420px]",
          isOpen ? "translate-x-0" : "translate-x-full",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Close button dentro del panel */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            <SparklesIcon className="h-4 w-4 text-violet-600" />
            ContaFlow IA
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              triggerRef.current?.focus();
            }}
            aria-label="Cerrar asistente"
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Chip contextual de anomalías */}
        {contextualChip && (
          <div
            className={[
              "mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
              anomaly.status === "critical"
                ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
            ].join(" ")}
          >
            {anomaly.status === "critical" ? (
              <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{contextualChip}</span>
          </div>
        )}

        {/* Chat — ocupa el espacio restante */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <AIAssistantChat companyId={companyId} companyName={companyName} />
        </div>
      </div>

      {/* ── Botón flotante ──────────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Abrir asistente ContaFlow IA"
        className={[
          "fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center",
          "rounded-full bg-violet-600 text-white shadow-lg",
          "transition-all duration-200",
          "hover:scale-110 hover:bg-violet-700 hover:shadow-xl",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
          "active:scale-95",
          isOpen && "scale-90 bg-violet-700",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SparklesIcon className="h-6 w-6" aria-hidden />

        {/* Badge de anomalías */}
        {badgeCount > 0 && !isOpen && (
          <span
            aria-label={`${badgeCount} anomalía${badgeCount > 1 ? "s" : ""} detectada${badgeCount > 1 ? "s" : ""}`}
            className={[
              "absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center",
              "rounded-full text-xs font-bold text-white ring-2 ring-white",
              badgeColor,
            ].join(" ")}
          >
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        )}
      </button>
    </>
  );
}
