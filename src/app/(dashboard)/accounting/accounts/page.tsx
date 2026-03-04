// src/app/(dashboard)/accounting/accounts/page.tsx
import { AccountsTable } from "@/components/accounting/AccountsTable";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { Toaster } from "@/components/ui/sonner";

export default async function AccountsPage() {
  const result = await getAccountsAction();
  const accounts = result.success ? result.data : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <AccountsTable initialAccounts={accounts} />
      <Toaster richColors position="top-right" />
    </main>
  );
}
