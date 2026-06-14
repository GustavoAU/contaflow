// src/app/(dashboard)/company/[companyId]/fiscal-calendar/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ChevronLeftIcon, CalendarDaysIcon, AlertTriangleIcon, CheckCircleIcon, ClockIcon } from "lucide-react";
import {
  getLastRifDigit,
  generateFiscalDeadlines,
  type FiscalDeadline,
} from "@/lib/fiscal-calendar";

type Props = { params: Promise<{ companyId: string }> };

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-VE", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
    timeZone: "UTC",
  });
}

function SeverityIcon({ severity }: { severity: FiscalDeadline["severity"] }) {
  if (severity === "overdue" || severity === "urgent") {
    return <AlertTriangleIcon className="h-4 w-4 text-red-500" />;
  }
  if (severity === "warning") {
    return <ClockIcon className="h-4 w-4 text-amber-500" />;
  }
  return <CheckCircleIcon className="h-4 w-4 text-green-500" />;
}

function rowClass(severity: FiscalDeadline["severity"]): string {
  switch (severity) {
    case "overdue": return "bg-red-50";
    case "urgent":  return "bg-red-50/60";
    case "warning": return "bg-amber-50/60";
    default:        return "";
  }
}

function badgeClass(severity: FiscalDeadline["severity"]): string {
  switch (severity) {
    case "overdue": return "bg-red-100 text-red-700";
    case "urgent":  return "bg-red-50 text-red-600";
    case "warning": return "bg-amber-50 text-amber-700";
    default:        return "bg-green-50 text-green-700";
  }
}

function daysLabel(d: FiscalDeadline): string {
  if (d.severity === "overdue") return `Vencido (${Math.abs(d.daysUntil)} días)`;
  if (d.daysUntil === 0)        return "Vence hoy";
  if (d.daysUntil === 1)        return "Mañana";
  return `En ${d.daysUntil} días`;
}

function TypeBadge({ type }: { type: FiscalDeadline["type"] }) {
  const map: Record<FiscalDeadline["type"], string> = {
    IVA_FORMA30:      "IVA F-30",
    IVA_RETENCION_1Q: "Ret. 1ª Q",
    IVA_RETENCION_2Q: "Ret. 2ª Q",
  };
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-mono text-zinc-600">
      {map[type] ?? type}
    </span>
  );
}

export default async function FiscalCalendarPage({ params }: Props) {
  const { companyId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: {
      role: true,
      company: { select: { name: true, rif: true, isSpecialContributor: true } },
    },
  });
  if (!member) redirect("/");

  const { company } = member;

  if (!company.rif) {
    return (
      <div className="space-y-6">
        <Link
          href={`/company/${companyId}`}
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Calendario Fiscal SENIAT</h1>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          El RIF de la empresa no está configurado. Configúralo en{" "}
          <Link href={`/company/${companyId}/settings`} className="underline">
            Configuración
          </Link>{" "}
          para ver el calendario de vencimientos.
        </div>
      </div>
    );
  }

  const lastDigit = getLastRifDigit(company.rif);
  if (lastDigit === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Calendario Fiscal SENIAT</h1>
        <p className="text-sm text-red-600">No se pudo determinar el último dígito del RIF ({company.rif}).</p>
      </div>
    );
  }

  const deadlines = generateFiscalDeadlines({
    lastDigit,
    isSpecialContributor: company.isSpecialContributor,
    monthsAhead: 13,
  });

  const overdueOrUrgent = deadlines.filter(
    (d) => d.severity === "overdue" || d.severity === "urgent"
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/company/${companyId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Dashboard
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calendario Fiscal SENIAT</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {company.name} · RIF {company.rif} · Último dígito:{" "}
              <span className="font-mono font-semibold">{lastDigit}</span>
              {company.isSpecialContributor && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Contribuyente Especial
                </span>
              )}
            </p>
          </div>
          <CalendarDaysIcon className="h-6 w-6 text-zinc-400" />
        </div>
      </div>

      {/* ─── Alertas urgentes ─────────────────────────────────────── */}
      {overdueOrUrgent.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-red-600" />
            <p className="text-sm font-semibold text-red-800">
              {overdueOrUrgent.length === 1
                ? "1 vencimiento requiere atención inmediata"
                : `${overdueOrUrgent.length} vencimientos requieren atención inmediata`}
            </p>
          </div>
          <ul className="space-y-1 pl-7">
            {overdueOrUrgent.map((d, i) => (
              <li key={i} className="text-sm text-red-700">
                {d.label} — {d.period} · Vence {fmtDate(d.dueDate)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Tabla de vencimientos ────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b bg-zinc-50">
            <tr className="text-xs text-zinc-500">
              <th className="px-4 py-3 text-left font-medium">Declaración</th>
              <th className="px-4 py-3 text-left font-medium">Período</th>
              <th className="px-4 py-3 text-left font-medium">Fecha límite</th>
              <th className="px-4 py-3 text-left font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {deadlines.map((d, i) => (
              <tr key={i} className={`hover:bg-zinc-50/40 ${rowClass(d.severity)}`}>
                <td className="px-4 py-2.5 flex items-center gap-2">
                  <SeverityIcon severity={d.severity} />
                  <span className="text-zinc-800">{d.label}</span>
                  <TypeBadge type={d.type} />
                </td>
                <td className="px-4 py-2.5 text-zinc-600">{d.period}</td>
                <td className="px-4 py-2.5 font-mono text-zinc-700">{fmtDate(d.dueDate)}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(d.severity)}`}>
                    {daysLabel(d)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-400">
        Las fechas son referencias basadas en el calendario SENIAT estándar. Si el vencimiento cae en
        un día no hábil, la fecha efectiva es el día hábil siguiente. Verifique el calendario oficial
        publicado en la Gaceta Oficial.
      </p>
    </div>
  );
}
