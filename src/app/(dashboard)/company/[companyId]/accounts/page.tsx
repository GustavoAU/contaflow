// src/app/(dashboard)/company/[companyId]/accounts/page.tsx
import { AccountsTable } from "@/components/accounting/AccountsTable";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { Toaster } from "@/components/ui/sonner";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function AccountsPage({ params }: Props) {
  const { companyId } = await params;
  const result = await getAccountsAction(companyId);
  const accounts = result.success ? result.data : [];

  return (
    <main>
      <AccountsTable initialAccounts={accounts} companyId={companyId} />
      <Toaster richColors position="top-right" />
    </main>
  );
}
