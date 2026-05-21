// src/app/(dashboard)/company/[companyId]/accounts/page.tsx
import { AccountsTable } from "@/components/accounting/AccountsTable";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { ModuleTabs } from "@/components/ui/ModuleTabs";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function AccountsPage({ params }: Props) {
  const { companyId } = await params;
  const result = await getAccountsAction(companyId);
  const accounts = result.success ? result.data : [];

  const contaTabs = [
    { label: "Asientos",        href: `/company/${companyId}/transactions` },
    { label: "Plan de Cuentas", href: `/company/${companyId}/accounts` },
    { label: "Reportes",        href: `/company/${companyId}/reports` },
  ];

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plan de Cuentas</h1>
        <p className="text-muted-foreground mt-1 text-sm">Catálogo de cuentas contables de tu empresa</p>
      </div>
      <ModuleTabs tabs={contaTabs} color="blue" />
      <AccountsTable initialAccounts={accounts} companyId={companyId} />
    </main>
  );
}
