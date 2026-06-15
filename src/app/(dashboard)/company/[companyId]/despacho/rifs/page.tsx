// ADR-034: Página de RIFs gestionados por el Despacho
import { redirect } from "next/navigation";
import { BriefcaseIcon } from "lucide-react";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { listManagedClientsAction } from "@/modules/despacho/actions/despacho.actions";
import { DespachoRifList } from "@/modules/despacho/components/DespachoRifList";

type Props = { params: Promise<{ companyId: string }> };

export default async function DespachoRifsPage({ params }: Props) {
  const { companyId } = await params;

  const companies = await getUserCompaniesAction();
  const company = companies.find((c) => c.id === companyId);
  if (!company) redirect("/dashboard");

  // Solo visible para perfil DESPACHO
  if (company.scopeProfile !== "DESPACHO") {
    redirect(`/company/${companyId}`);
  }

  const result = await listManagedClientsAction(companyId);
  if (!result.success) redirect(`/company/${companyId}`);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <BriefcaseIcon className="h-6 w-6 text-violet-600" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Clientes del Despacho
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            RIFs que gestionas desde esta cuenta
          </p>
        </div>
      </div>

      <DespachoRifList
        companyId={companyId}
        clients={result.clients}
        currentCount={result.currentCount}
        limit={result.limit}
      />
    </div>
  );
}
