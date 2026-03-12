// src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  syncUserAction,
  getUserCompaniesAction,
  getArchivedCompaniesAction,
} from "@/modules/auth/actions/user.actions";
import { PlusIcon, BuildingIcon, ArchiveIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactivateCompanyButton } from "@/components/company/ReactivateCompanyButton";
import { currentUser } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  await syncUserAction();

  const user = await currentUser();
  const companies = await getUserCompaniesAction();
  const archivedCompanies = await getArchivedCompaniesAction();

  if (!user) redirect("/sign-in");

  if (companies.length === 1 && archivedCompanies.length === 0) {
    redirect(`/company/${companies[0].id}`);
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* ─── Encabezado ──────────────────────────────────────────────── */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {companies.length === 0 && archivedCompanies.length === 0
                ? "Bienvenido a ContaFlow"
                : "Mis Empresas"}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {companies.length === 0 && archivedCompanies.length === 0
                ? "Crea tu primera empresa para comenzar"
                : `${companies.length} activa${companies.length !== 1 ? "s" : ""}${archivedCompanies.length > 0 ? `, ${archivedCompanies.length} archivada${archivedCompanies.length !== 1 ? "s" : ""}` : ""}`}
            </p>
          </div>
          <Button asChild>
            <Link href="/company/new" className="gap-2">
              <PlusIcon className="h-4 w-4" />
              Nueva Empresa
            </Link>
          </Button>
        </div>

        {/* ─── Empresas activas ────────────────────────────────────────── */}
        {companies.length === 0 && archivedCompanies.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-white p-12 text-center">
            <BuildingIcon className="mx-auto mb-4 h-10 w-10 text-zinc-300" />
            <p className="font-semibold text-zinc-700">No tienes empresas activas</p>
            <p className="text-muted-foreground mt-1 mb-6 text-sm">
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <Link
                key={company.id}
                href={`/company/${company.id}`}
                className="block rounded-lg border bg-white p-6 transition-all hover:border-blue-500 hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{company.name}</h2>
                    {company.rif && (
                      <p className="text-muted-foreground mt-1 text-sm">RIF: {company.rif}</p>
                    )}
                  </div>
                  <BuildingIcon className="h-5 w-5 shrink-0 text-zinc-300" />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                    {company.role}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {new Date(company.createdAt).toLocaleDateString("es-VE")}
                  </span>
                </div>
              </Link>
            ))}

            {/* Card nueva empresa */}
            <Link
              href="/company/new"
              className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-white p-6 text-zinc-400 transition-all hover:border-blue-400 hover:bg-blue-50 hover:text-blue-500"
            >
              <PlusIcon className="mb-2 h-8 w-8" />
              <span className="text-sm font-medium">Nueva Empresa</span>
            </Link>
          </div>
        )}

        {/* ─── Empresas archivadas ─────────────────────────────────────── */}
        {archivedCompanies.length > 0 && (
          <div className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <ArchiveIcon className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-semibold text-zinc-500">Empresas Archivadas</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archivedCompanies.map((company) => (
                <div key={company.id} className="rounded-lg border bg-white p-6 opacity-70">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="font-semibold text-zinc-500">{company.name}</h2>
                      {company.rif && (
                        <p className="text-muted-foreground mt-1 text-sm">RIF: {company.rif}</p>
                      )}
                    </div>
                    <ArchiveIcon className="h-5 w-5 shrink-0 text-zinc-300" />
                  </div>
                  <div className="mt-4">
                    <ReactivateCompanyButton
                      companyId={company.id}
                      companyName={company.name}
                      userId={user.id}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
