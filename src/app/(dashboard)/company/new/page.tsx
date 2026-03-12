// src/app/(dashboard)/company/new/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { NewCompanyForm } from "@/components/company/NewCompanyForm";

export default async function NewCompanyPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-lg px-4 py-12">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Mis Empresas
        </Link>

        <div className="rounded-lg border bg-white p-8">
          <h1 className="mb-1 text-2xl font-bold tracking-tight">Nueva Empresa</h1>
          <p className="text-muted-foreground mb-6 text-sm">
            Completa los datos de tu empresa para comenzar
          </p>

          <NewCompanyForm userId={user.id} />
        </div>
      </div>
    </div>
  );
}
