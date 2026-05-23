// src/app/(dashboard)/company/[companyId]/payroll/reports/page.tsx
// Fase NOM-E: Hub de Reportes Legales de Nómina
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";

type Props = { params: Promise<{ companyId: string }> };

const REPORTS = [
  {
    slug: "ivss",
    title: "IVSS — Forma 14-02",
    description: "Cotizaciones mensuales obreras y patronales al Seguro Social",
    badge: "LSS Art. 62",
    color: "blue",
  },
  {
    slug: "banavih",
    title: "Banavih / FAOV",
    description: "Fondo de Ahorro Obligatorio para Vivienda — mensual",
    badge: "LAH Art. 172",
    color: "emerald",
  },
  {
    slug: "inces",
    title: "INCES",
    description: "Aporte trimestral al Instituto Nacional de Capacitación",
    badge: "Ley INCES Art. 30",
    color: "violet",
  },
  {
    slug: "arc",
    title: "ARC / ISLR Empleados",
    description: "Comprobante anual de retención ISLR (Decreto 1.808 Tarifa 1)",
    badge: "D.1808",
    color: "amber",
  },
];

const COLOR_MAP: Record<string, string> = {
  blue: "border-blue-100 bg-blue-50 hover:bg-blue-100",
  emerald: "border-emerald-100 bg-emerald-50 hover:bg-emerald-100",
  violet: "border-violet-100 bg-violet-50 hover:bg-violet-100",
  amber: "border-amber-100 bg-amber-50 hover:bg-amber-100",
};
const BADGE_MAP: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  emerald: "bg-emerald-100 text-emerald-700",
  violet: "bg-violet-100 text-violet-700",
  amber: "bg-amber-100 text-amber-700",
};

export default async function PayrollReportsPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
    select: { role: true },
  });
  if (!member) redirect("/");
  if (!canAccess(member.role, ROLES.ACCOUNTING)) redirect(`/company/${companyId}/payroll`);

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8 px-4">
      <div>
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-1">
          <Link href={`/company/${companyId}/payroll`} className="hover:text-zinc-800">Nómina</Link>
          <span>›</span>
          <span>Reportes Legales</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Reportes Legales</h1>
        <p className="mt-1 text-sm text-gray-500">
          IVSS, INCES, Banavih y ARC según legislación venezolana vigente.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {REPORTS.map((report) => (
          <Link
            key={report.slug}
            href={`/company/${companyId}/payroll/reports/${report.slug}`}
            className={`rounded-xl border p-5 transition-colors ${COLOR_MAP[report.color]}`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-semibold text-zinc-900">{report.title}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-medium ${BADGE_MAP[report.color]}`}>
                {report.badge}
              </span>
            </div>
            <p className="text-sm text-zinc-600">{report.description}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500">
        <p className="font-medium text-zinc-700 mb-1">Nota importante</p>
        <p>
          Los reportes generados por ContaFlow son documentos de referencia contable para el contador.
          Las declaraciones oficiales se realizan en los sistemas propios de cada organismo
          (TIUNA / IVSS, FAOV-Web / Banavih, portal INCES, SENIAT).
        </p>
      </div>
    </div>
  );
}
