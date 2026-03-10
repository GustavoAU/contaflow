// src/app/(dashboard)/company/[companyId]/reports/page.tsx
import Link from "next/link";
import { BookOpenIcon, ScaleIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function ReportsPage({ params }: Props) {
  const { companyId } = await params;

  const reports = [
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
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
        <p className="text-muted-foreground mt-1 text-sm">Reportes contables de tu empresa</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((report) => {
          const Icon = report.icon;
          return (
            <Link
              key={report.href}
              href={report.href}
              className="group rounded-lg border bg-white p-6 transition-all hover:border-blue-500 hover:shadow-sm"
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
