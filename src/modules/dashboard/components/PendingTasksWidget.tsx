"use client";
// src/modules/dashboard/components/PendingTasksWidget.tsx

import Link from "next/link";
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon, SparklesIcon } from "lucide-react";
import type { PendingTasksData } from "../services/PendingTasksService";

type Props = {
  companyId: string;
  data: PendingTasksData & { aiSummary: string | null };
};

const SEVERITY_STYLES = {
  error:   { icon: AlertCircleIcon,   bg: "bg-red-50 border-red-200",    icon_class: "text-red-500",    badge: "bg-red-100 text-red-700" },
  warning: { icon: AlertTriangleIcon, bg: "bg-amber-50 border-amber-200", icon_class: "text-amber-500",  badge: "bg-amber-100 text-amber-700" },
  info:    { icon: InfoIcon,           bg: "bg-blue-50 border-blue-200",  icon_class: "text-blue-500",   badge: "bg-blue-100 text-blue-700" },
};

export function PendingTasksWidget({ companyId, data }: Props) {
  if (data.tasks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
          Tareas pendientes
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
            {data.totalCount}
          </span>
        </h2>
      </div>

      {/* Resumen IA */}
      {data.aiSummary && (
        <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
          <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
          <p className="text-sm text-violet-800">{data.aiSummary}</p>
        </div>
      )}

      {/* Lista de tareas */}
      <div className="space-y-2">
        {data.tasks.map((task) => {
          const style = SEVERITY_STYLES[task.severity];
          const Icon = style.icon;
          return (
            // Q3-4 Mobile-first: min-h-[52px] garantiza tap target ≥44px (WCAG 2.5.8)
            <Link
              key={task.type}
              href={`/company/${companyId}${task.href}`}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 min-h-[52px] transition-opacity hover:opacity-80 active:opacity-70 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 ${style.bg}`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${style.icon_class}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-800">{task.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>
                    {task.count}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-600">{task.description}</p>
              </div>
              <span className="shrink-0 text-zinc-400" aria-hidden>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
