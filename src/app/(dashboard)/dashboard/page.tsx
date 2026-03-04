// src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { syncUserAction, getUserCompaniesAction } from "@/modules/auth/actions/user.actions";

export default async function DashboardPage() {
  await syncUserAction();

  const companies = await getUserCompaniesAction();

  if (companies.length === 0) {
    redirect("/company/new");
  }

  if (companies.length === 1) {
    redirect(`/company/${companies[0].id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Selecciona una Empresa</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tienes acceso a {companies.length} empresas
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {companies.map((company) => (
          <a
            key={company.id}
            href={`/company/${company.id}`}
            className="block rounded-lg border p-6 transition-all hover:border-blue-500 hover:shadow-sm"
          >
            <h2 className="font-semibold">{company.name}</h2>
            {company.rif && (
              <p className="text-muted-foreground mt-1 text-sm">RIF: {company.rif}</p>
            )}
            <span className="mt-2 inline-block text-xs text-blue-600">{company.role}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
