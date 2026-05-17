// src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  syncUserAction,
  getUserCompaniesAction,
  getArchivedCompaniesAction,
} from "@/modules/auth/actions/user.actions";
import { PlusIcon, ArchiveIcon, Settings2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactivateCompanyButton } from "@/components/company/ReactivateCompanyButton";
import { CompanyAvatar } from "@/components/company/CompanyAvatar";
import { currentUser } from "@clerk/nextjs/server";
import type { UserRole } from "@/lib/nav-items";

// ─── Role badge styles ─────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER:          "Propietario",
  ADMIN:          "Administrador",
  ACCOUNTANT:     "Contador",
  ADMINISTRATIVE: "Administrativo",
  VIEWER:         "Lector",
  SENIAT:         "Auditor SENIAT",
};

const ROLE_BADGE: Record<UserRole, string> = {
  OWNER:          "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  ADMIN:          "bg-blue-50   text-blue-700   ring-1 ring-blue-200",
  ACCOUNTANT:     "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  ADMINISTRATIVE: "bg-amber-50  text-amber-700  ring-1 ring-amber-200",
  VIEWER:         "bg-zinc-100  text-zinc-600   ring-1 ring-zinc-200",
  SENIAT:         "bg-red-50    text-red-700    ring-1 ring-red-200",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  await syncUserAction();

  const user = await currentUser();
  const companies = await getUserCompaniesAction();
  const archivedCompanies = await getArchivedCompaniesAction();

  if (!user) redirect("/sign-in");

  if (companies.length === 1 && archivedCompanies.length === 0) {
    redirect(`/company/${companies[0].id}`);
  }

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
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center text-2xl">
              🏢
            </div>
            <p className="font-semibold text-zinc-700 text-lg">No tienes empresas activas</p>
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
            {companies.map((company) => {
              const role = company.role as UserRole;
              return (
                <div
                  key={company.id}
                  className="group relative rounded-xl border bg-white transition-all hover:border-blue-300 hover:shadow-md"
                >
                  {/* Main clickable area */}
                  <Link
                    href={`/company/${company.id}`}
                    className="block p-5"
                  >
                    {/* Avatar + nombre */}
                    <div className="flex items-start gap-3 mb-4">
                      <CompanyAvatar id={company.id} name={company.name} size="md" />
                      <div className="flex-1 min-w-0 pt-0.5">
                        <h2 className="font-semibold text-zinc-900 leading-tight truncate">
                          {company.name}
                        </h2>
                        {company.rif && (
                          <p className="text-xs text-zinc-400 mt-0.5">RIF: {company.rif}</p>
                        )}
                      </div>
                    </div>

                    {/* Badge de rol + fecha */}
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[role]}`}>
                        {ROLE_LABELS[role]}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Miembro desde: {new Date(company.createdAt).toLocaleDateString("es-VE")}
                      </span>
                    </div>
                  </Link>

                  {/* Quick actions — aparecen al hover */}
                  <div className="hidden group-hover:flex items-center gap-1 px-5 py-2.5 border-t border-zinc-100">
                    <Link
                      href={`/company/${company.id}`}
                      className="flex-1 text-center text-[12px] font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-md px-3 py-1.5 transition-colors"
                    >
                      Entrar
                    </Link>
                    <Link
                      href={`/company/${company.id}/settings`}
                      className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-md px-3 py-1.5 transition-colors"
                    >
                      <Settings2Icon className="w-3.5 h-3.5" />
                      Configurar
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
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
                  <div className="flex items-start gap-3 mb-4">
                    <CompanyAvatar id={company.id} name={company.name} size="md" className="grayscale" />
                    <div className="flex-1 min-w-0 pt-0.5">
                      <h2 className="font-semibold text-zinc-500 leading-tight truncate">
                        {company.name}
                      </h2>
                      {company.rif && (
                        <p className="text-xs text-zinc-400 mt-0.5">RIF: {company.rif}</p>
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
