// src/app/(dashboard)/company/[companyId]/ai-assistant/page.tsx
//
// Página completa del Asistente ContaFlow IA.
// Muestra resumen de anomalías fiscales y el chat full-height.

import { redirect } from "next/navigation";
import {
  SparklesIcon,
  ShieldAlertIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  MessageSquareIcon,
  SearchIcon,
  FileTextIcon,
  TrendingUpIcon,
} from "lucide-react";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { getAnomalySummaryAction } from "@/modules/ai-assistant/actions/ai-assistant.actions";
import { AIAssistantChat } from "@/modules/ai-assistant/components/AIAssistantChat";

type Props = { params: Promise<{ companyId: string }> };

export const metadata = { title: "Asistente IA — ContaFlow" };

// ─── Capability chips ──────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    icon: SearchIcon,
    label: "Auditoría fiscal",
    hint: "Detecta errores en libros y declaraciones",
  },
  {
    icon: TrendingUpIcon,
    label: "Análisis financiero",
    hint: "Compara períodos, márgenes y KPIs clave",
  },
  {
    icon: FileTextIcon,
    label: "Normativa venezolana",
    hint: "IVA, IGTF, retenciones e ISLR al día",
  },
  {
    icon: MessageSquareIcon,
    label: "Asistente contable",
    hint: "Asientos, errores y cierre guiado",
  },
];

export default async function AIAssistantPage({ params }: Props) {
  const { companyId } = await params;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  const anomaly = await getAnomalySummaryAction(companyId);
  const criticalCount = anomaly.success ? anomaly.critical : 0;
  const highCount = anomaly.success ? anomaly.high : 0;
  const hasCritical = criticalCount > 0;
  const hasHigh = highCount > 0;
  const isClean = anomaly.success && criticalCount === 0 && highCount === 0;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 shadow-md shadow-violet-500/30">
            <SparklesIcon className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              Asistente IA
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Análisis fiscal inteligente ·{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {company.name}
              </span>
            </p>
          </div>
        </div>

        {/* Estado anomalías — badge compacto */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {hasCritical && (
            <span className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              <ShieldAlertIcon className="h-3.5 w-3.5" />
              {criticalCount} crítica{criticalCount !== 1 ? "s" : ""}
            </span>
          )}
          {hasHigh && (
            <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangleIcon className="h-3.5 w-3.5" />
              {highCount} importante{highCount !== 1 ? "s" : ""}
            </span>
          )}
          {isClean && (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              Sin anomalías
            </span>
          )}
        </div>
      </div>

      {/* ── Banner alerta crítica ────────────────────────────────────────────── */}
      {hasCritical && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/50">
          <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              {criticalCount} anomalía{criticalCount !== 1 ? "s" : ""} crítica
              {criticalCount !== 1 ? "s" : ""} detectada{criticalCount !== 1 ? "s" : ""}
            </p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              Escribe{" "}
              <code className="rounded bg-red-100 px-1 py-0.5 text-[10px] dark:bg-red-900">
                Auditar el período actual
              </code>{" "}
              en el chat para ver el informe completo.
            </p>
          </div>
        </div>
      )}

      {/* ── Capabilities ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CAPABILITIES.map(({ icon: Icon, label, hint }) => (
          <div
            key={label}
            className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950">
              <Icon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <p className="text-xs font-semibold leading-tight text-zinc-700 dark:text-zinc-300">
              {label}
            </p>
            <p className="text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">{hint}</p>
          </div>
        ))}
      </div>

      {/* ── Chat panel ───────────────────────────────────────────────────────── */}
      <div
        className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
        style={{ height: "calc(100vh - 22rem)" }}
      >
        <AIAssistantChat companyId={companyId} companyName={company.name} />
      </div>
    </div>
  );
}
