"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon, XIcon, Settings2Icon, AlertCircleIcon } from "lucide-react";
import { CompanyAvatar } from "./CompanyAvatar";
import type { UserRole } from "@/lib/nav-items";

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

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"] as const;

export type CompanyWithPeriod = {
  id: string;
  name: string;
  rif: string | null;
  role: UserRole;
  activePeriod: { year: number; month: number; status: string } | null;
};

export function CompanyGrid({ companies }: { companies: CompanyWithPeriod[] }) {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const filtered = query.trim()
    ? companies.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          (c.rif ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : companies;

  return (
    <div>
      {/* Search — visible once there are more than 3 companies */}
      {companies.length > 3 && (
        <div className="relative mb-5">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o RIF…"
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-9 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
              aria-label="Limpiar búsqueda"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          Sin resultados para &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((company) => {
            const role = company.role;
            const period = company.activePeriod;
            return (
              <div
                key={company.id}
                className="group relative rounded-xl border bg-white transition-all hover:border-blue-300 hover:shadow-md"
              >
                <Link href={`/company/${company.id}`} className="block p-5 pb-14">
                  {/* Avatar + nombre */}
                  <div className="mb-4 flex items-start gap-3">
                    <CompanyAvatar id={company.id} name={company.name} size="md" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <h2
                        className="line-clamp-2 font-semibold leading-tight text-zinc-900"
                        title={company.name}
                      >
                        {company.name}
                      </h2>
                      {company.rif && (
                        <p className="mt-0.5 text-xs text-zinc-400">RIF: {company.rif}</p>
                      )}
                    </div>
                  </div>

                  {/* Role badge + período activo */}
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-11 font-semibold ${ROLE_BADGE[role]}`}>
                      {ROLE_LABELS[role]}
                    </span>

                    {period ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-11 font-medium ${
                          period.status === "OPEN"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200"
                        }`}
                        title={period.status === "OPEN" ? "Período contable abierto" : "Período contable cerrado"}
                      >
                        {MONTHS[period.month - 1]} {period.year}
                        {period.status !== "OPEN" && (
                          <span className="ml-1 opacity-60">·&nbsp;cerrado</span>
                        )}
                      </span>
                    ) : (
                      /* Botón en lugar de Link anidado — evita <a> dentro de <a> */
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(`/company/${company.id}/periods`);
                        }}
                        className="inline-flex items-center gap-1 text-11 font-medium text-amber-600 hover:text-amber-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 rounded"
                      >
                        <AlertCircleIcon className="h-3 w-3 shrink-0" aria-hidden />
                        Sin período · Crear →
                      </button>
                    )}
                  </div>
                </Link>

                {/* Quick actions — absolute overlay, never affects card height */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 rounded-b-xl border-t border-zinc-100 bg-white px-5 py-2.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <Link
                    href={`/company/${company.id}`}
                    className="flex-1 rounded-md bg-blue-500 px-3 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:bg-blue-600"
                  >
                    Entrar
                  </Link>
                  <Link
                    href={`/company/${company.id}/settings`}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
                  >
                    <Settings2Icon className="h-3.5 w-3.5" />
                    Configurar
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
