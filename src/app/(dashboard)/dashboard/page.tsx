// src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  syncUserAction,
  getUserCompaniesAction,
  getArchivedCompaniesAction,
} from "@/modules/auth/actions/user.actions";
import { PlusIcon, ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactivateCompanyButton } from "@/components/company/ReactivateCompanyButton";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import { CompanyGrid, type CompanyWithPeriod } from "@/components/company/CompanyGrid";
import { currentUser } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import type { UserRole } from "@/lib/nav-items";

export default async function DashboardPage() {
  await syncUserAction();

  const user = await currentUser();
  const companies = await getUserCompaniesAction();
  const archivedCompanies = await getArchivedCompaniesAction();

  if (!user) redirect("/sign-in");

  if (companies.length === 1 && archivedCompanies.length === 0) {
    redirect(`/company/${companies[0].id}`);
  }

  // Fetch latest accounting period per active company (single batched query)
  const companyIds = companies.map((c) => c.id);
  const rawPeriods = companyIds.length > 0
    ? await prisma.accountingPeriod.findMany({ // ADR-004-EXCEPTION: cross-company intencional — selector de empresa del usuario
        where: { companyId: { in: companyIds } },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { companyId: true, year: true, month: true, status: true },
      })
    : [];

  const periodMap = new Map<string, { year: number; month: number; status: string }>();
  for (const p of rawPeriods) {
    if (!periodMap.has(p.companyId)) {
      periodMap.set(p.companyId, { year: p.year, month: p.month, status: p.status });
    }
  }

  const companiesWithPeriod: CompanyWithPeriod[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    rif: c.rif,
    role: c.role as UserRole,
    activePeriod: periodMap.get(c.id) ?? null,
  }));

  const hasCompanies = companies.length > 0 || archivedCompanies.length > 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-4 py-12">

        {/* ─── Encabezado ────────────────────────────────────────────────── */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {hasCompanies ? "Mis Empresas" : "Bienvenido a ContaFlow"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {hasCompanies
                ? `${companies.length} activa${companies.length !== 1 ? "s" : ""}${
                    archivedCompanies.length > 0
                      ? ` · ${archivedCompanies.length} archivada${archivedCompanies.length !== 1 ? "s" : ""}`
                      : ""
                  }`
                : "Crea tu primera empresa para comenzar"}
            </p>
          </div>
          <Button asChild>
            <Link href="/company/new" className="gap-2">
              <PlusIcon className="h-4 w-4" />
              Nueva Empresa
            </Link>
          </Button>
        </div>

        {/* ─── Empresas activas ───────────────────────────────────────────── */}
        {!hasCompanies ? (
          <div className="rounded-xl border border-dashed bg-white p-14 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-2xl">
              🏢
            </div>
            <p className="text-lg font-semibold text-zinc-700">No tienes empresas activas</p>
            <p className="text-muted-foreground mb-6 mt-1 text-sm">
              Crea tu primera empresa para comenzar a contabilizar
            </p>
            <Button asChild>
              <Link href="/company/new" className="gap-2">
                <PlusIcon className="h-4 w-4" />
                Crear Empresa
              </Link>
            </Button>
          </div>
        ) : (
          <CompanyGrid companies={companiesWithPeriod} />
        )}

        {/* ─── Empresas archivadas ────────────────────────────────────────── */}
        {archivedCompanies.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <ArchiveIcon className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-semibold text-zinc-500">Empresas Archivadas</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archivedCompanies.map((company) => (
                <div key={company.id} className="rounded-xl border bg-white p-5 opacity-60">
                  <div className="mb-4 flex items-start gap-3">
                    <CompanyAvatar id={company.id} name={company.name} size="md" className="grayscale" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <h2 className="line-clamp-2 font-semibold leading-tight text-zinc-500">
                        {company.name}
                      </h2>
                      {company.rif && (
                        <p className="mt-0.5 text-xs text-zinc-400">RIF: {company.rif}</p>
                      )}
                    </div>
                  </div>
                  <ReactivateCompanyButton
                    companyId={company.id}
                    companyName={company.name}
                    userId={user.id}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
