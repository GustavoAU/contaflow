// src/app/(dashboard)/company/[companyId]/transactions/new/page.tsx
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm";
import { Toaster } from "@/components/ui/sonner";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function NewTransactionPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const result = await getAccountsAction(companyId);
  const accounts = result.success ? result.data : [];

  return (
    <div>
      <JournalEntryForm companyId={companyId} userId={user.id} accounts={accounts} />
      <Toaster richColors position="top-right" />
    </div>
  );
}
