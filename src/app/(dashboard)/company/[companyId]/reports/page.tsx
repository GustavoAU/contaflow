// src/app/(dashboard)/company/[companyId]/reports/page.tsx
import Link from "next/link";
import { BookOpenIcon, ScaleIcon, TrendingUpIcon, LayoutIcon, ClipboardListIcon, ChevronLeftIcon } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { NavigationCard } from "@/components/ui/NavigationCard";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function ReportsPage({ params }: Props) {
  const { companyId } = await params;

  const reports = [
    {
      title: "Libro Diario",
      description: "Registro cronológico de todos los asientos con partida doble completa",
      href: `/company/${companyId}/reports/journal`,
      icon: ClipboardListIcon,
    },
    {
      title: "Libro Mayor",
      description: "Movimientos detallados por cuenta con saldo acumulado",
      href: `/company/${companyId}/reports/ledger`,
      icon: BookOpenIcon,
    },
    {
      title: "Balance de Comprobación",
      description: "Sumas y saldos de todas las cuentas del período",
      href: `/company/${companyId}/reports/trial-balance`,
      icon: ScaleIcon,
    },
    {
      title: "Estado de Resultados",
      description: "Ingresos y gastos del período — utilidad o pérdida",
      href: `/company/${companyId}/reports/income-statement`,
      icon: TrendingUpIcon,
    },
    {
      title: "Balance General",
      description: "Activos, Pasivos y Patrimonio — situación financiera",
      href: `/company/${companyId}/reports/balance-sheet`,
      icon: LayoutIcon,
    },
  ];

  const contaTabs = [
    { label: "Asientos",        href: `/company/${companyId}/transactions` },
    { label: "Plan de Cuentas", href: `/company/${companyId}/accounts` },
    { label: "Reportes",        href: `/company/${companyId}/reports` },
  ];

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
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground mt-1 text-sm">Reportes contables de tu empresa</p>
      </div>

      <ModuleTabs tabs={contaTabs} color="blue" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <NavigationCard
              key={report.href}
              href={report.href}
              className="group rounded-lg border bg-white p-6 transition-all hover:border-blue-500 hover:shadow-sm dark:bg-zinc-950"
            >
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-blue-50 p-2 transition-colors group-hover:bg-blue-100">
                  <Icon className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold">{report.title}</h2>
                  <p className="text-muted-foreground mt-1 text-sm">{report.description}</p>
                </div>
              </div>
            </NavigationCard>
          );
        })}
      </div>
    </div>
  );
}
