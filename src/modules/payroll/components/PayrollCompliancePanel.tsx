"use client";
// src/modules/payroll/components/PayrollCompliancePanel.tsx
// U-05: panel semáforo de cumplimiento legal en hub de nómina

import Link from "next/link";

type TrafficLight = "green" | "amber" | "red" | "gray";

interface CheckItem {
  label: string;
  detail: string;
  status: TrafficLight;
  href?: string;
  hrefLabel?: string;
}

function Dot({ status }: { status: TrafficLight }) {
  const classes: Record<TrafficLight, string> = {
    green: "bg-green-500",
    amber: "bg-amber-400",
    red: "bg-red-500",
    gray: "bg-gray-300",
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${classes[status]}`} />;
}

interface Props {
  companyId: string;
  checks: CheckItem[];
}

export default function PayrollCompliancePanel({ companyId, checks }: Props) {
  const criticalCount = checks.filter((c) => c.status === "red").length;
  const warningCount = checks.filter((c) => c.status === "amber").length;

  const overallStatus: TrafficLight =
    criticalCount > 0 ? "red" : warningCount > 0 ? "amber" : "green";

  const overallLabel =
    overallStatus === "green"
      ? "Nómina al día"
      : overallStatus === "amber"
        ? `${warningCount} alerta${warningCount !== 1 ? "s" : ""} pendiente${warningCount !== 1 ? "s" : ""}`
        : `${criticalCount} incumplimiento${criticalCount !== 1 ? "s" : ""} crítico${criticalCount !== 1 ? "s" : ""}`;

  const headerBg =
    overallStatus === "green"
      ? "bg-green-50 border-green-200"
      : overallStatus === "amber"
        ? "bg-amber-50 border-amber-200"
        : "bg-red-50 border-red-200";

  const headerText =
    overallStatus === "green"
      ? "text-green-800"
      : overallStatus === "amber"
        ? "text-amber-800"
        : "text-red-800";

  return (
    <section className={`rounded-lg border ${headerBg} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 ${headerText}`}>
        <div className="flex items-center gap-2">
          <Dot status={overallStatus} />
          <p className="text-sm font-semibold">Estado de Cumplimiento Legal</p>
        </div>
        <span className="text-xs font-medium">{overallLabel}</span>
      </div>

      <div className="divide-y divide-gray-100 bg-white">
        {checks.map((check) => (
          <div key={check.label} className="flex items-start gap-3 px-4 py-2.5">
            <Dot status={check.status} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-800">{check.label}</p>
              <p className="text-xs text-gray-500">{check.detail}</p>
            </div>
            {check.href && (
              <Link
                href={`/company/${companyId}${check.href}`}
                className="shrink-0 text-xs text-blue-600 hover:underline"
              >
                {check.hrefLabel ?? "Ir"}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
