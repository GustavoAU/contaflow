// src/app/(dashboard)/accounting/accounts/page.tsx
import { AccountsTable } from "@/components/accounting/AccountsTable";
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getUserCompaniesAction } from "@/modules/auth/actions/user.actions";
import { Toaster } from "@/components/ui/sonner";
import { redirect } from "next/navigation";

export default async function AccountsPage() {
  const companies = await getUserCompaniesAction();
  if (companies.length === 0) redirect("/dashboard");
  const companyId = companies[0].id;
  const result = await getAccountsAction(companyId);
  const accounts = result.success ? result.data : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <AccountsTable initialAccounts={accounts} companyId={companyId} />
      <Toaster richColors position="top-right" />
    </main>
  );
}
