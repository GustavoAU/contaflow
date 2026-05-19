// src/modules/dashboard/components/FiscalDeadlineWidget.tsx
import Link from "next/link";
import { CalendarDaysIcon, AlertTriangleIcon, CheckCircleIcon, ClockIcon } from "lucide-react";
import { getLastRifDigit, generateFiscalDeadlines } from "@/lib/fiscal-calendar";
import type { FiscalDeadline } from "@/lib/fiscal-calendar";

type Props = {
  companyId: string;
  rif: string;
  isSpecialContributor?: boolean;
};

function SeverityIcon({ severity }: { severity: FiscalDeadline["severity"] }) {
  if (severity === "overdue" || severity === "urgent") {
    return <AlertTriangleIcon className="h-4 w-4 shrink-0 text-red-500" />;
  }
  if (severity === "warning") {
    return <ClockIcon className="h-4 w-4 shrink-0 text-amber-500" />;
  }
  return <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-500" />;
}

function severityBadge(d: FiscalDeadline): string {
  if (d.severity === "overdue") return "Vencido";
  if (d.daysUntil === 0)        return "Hoy";
  if (d.daysUntil === 1)        return "Mañana";
  return `${d.daysUntil} días`;
}

function badgeClass(severity: FiscalDeadline["severity"]): string {
  switch (severity) {
    case "overdue": return "bg-red-100 text-red-700";
    case "urgent":  return "bg-red-50 text-red-600";
    case "warning": return "bg-amber-50 text-amber-700";
    default:        return "bg-green-50 text-green-700";
  }
}

export function FiscalDeadlineWidget({ companyId, rif, isSpecialContributor }: Props) {
  const lastDigit = getLastRifDigit(rif);
  if (lastDigit === null) return null;

  const all      = generateFiscalDeadlines({ lastDigit, isSpecialContributor, monthsAhead: 3 });
  // Show the 3 most relevant: overdue first, then upcoming
  const upcoming = all.filter((d) => d.daysUntil >= -30).slice(0, 4);
  if (upcoming.length === 0) return null;

  const hasAlert = upcoming.some((d) => d.severity === "overdue" || d.severity === "urgent");

  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 ${hasAlert ? "border-red-200 bg-red-50" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className={`h-4 w-4 ${hasAlert ? "text-red-500" : "text-zinc-500"}`} />
          <span className={`text-sm font-semibold ${hasAlert ? "text-red-800" : "text-zinc-700"}`}>
            Vencimientos SENIAT
          </span>
          <span className="text-xs text-zinc-500 font-mono">dígito {lastDigit}</span>
        </div>
        <Link
          href={`/company/${companyId}/fiscal-calendar`}
          className="text-xs text-blue-600 hover:underline"
        >
          Ver calendario →
        </Link>
      </div>

      <ul className="space-y-1">
        {upcoming.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <SeverityIcon severity={d.severity} />
            <span className="flex-1 text-zinc-700">
              {d.label}{" "}
              <span className="text-zinc-500 text-xs">({d.period})</span>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(d.severity)}`}>
              {severityBadge(d)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
