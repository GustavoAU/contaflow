// src/app/(dashboard)/company/[companyId]/accounts/page.tsx
import { AccountsTable } from "@/components/accounting/AccountsTable";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";

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
    </main>
  );
}
