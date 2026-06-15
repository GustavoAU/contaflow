// src/app/(dashboard)/company/new/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { NewCompanyForm } from "@/components/company/NewCompanyForm";
import { cookies } from "next/headers";

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { profile } = await searchParams;
  // Si no viene por URL param, intentamos leer la cookie que pone el BotRecomendador
  const cookieStore = await cookies();
  const cookieProfile = cookieStore.get("cf-pending-profile")?.value;
  const resolvedProfile = profile ?? cookieProfile;

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

          <NewCompanyForm userId={user.id} initialProfile={resolvedProfile} />
        </div>
      </div>
    </div>
  );
}
