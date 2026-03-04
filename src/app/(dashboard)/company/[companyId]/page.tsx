// src/app/(dashboard)/company/[companyId]/page.tsx
import { redirect } from "next/navigation";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function CompanyDashboardPage({ params }: Props) {
  const { companyId } = await params;
  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);

  if (!company) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
        {company.rif && <p className="text-muted-foreground text-sm">RIF: {company.rif}</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">Plan de Cuentas</p>
          <p className="mt-1 text-2xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">Asientos del Mes</p>
          <p className="mt-1 text-2xl font-bold">—</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">Ultimo Asiento</p>
          <p className="mt-1 text-2xl font-bold">—</p>
        </div>
      </div>
    </div>
  );
}
