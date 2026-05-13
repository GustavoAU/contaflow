// src/app/(dashboard)/company/[companyId]/transactions/new/page.tsx
import { getAccountsAction } from "@/modules/accounting/actions/account.actions";
import { getActivePeriodAction } from "@/modules/accounting/actions/period.actions";
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm";
import { PrerequisiteGuide } from "@/components/guides/PrerequisiteGuide";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function NewTransactionPage({ params }: Props) {
  const { companyId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const [accountsResult, periodResult] = await Promise.all([
    getAccountsAction(companyId),
    getActivePeriodAction(companyId),
  ]);

  const accounts = accountsResult.success ? accountsResult.data : [];
  const hasOpenPeriod = periodResult.success && periodResult.data !== null;
  const hasAccounts = accounts.length > 0;

  if (!hasOpenPeriod) {
    return (
      <div className="max-w-lg py-8">
        <PrerequisiteGuide type="period" companyId={companyId} />
      </div>
    );
  }

  if (!hasAccounts) {
    return (
      <div className="max-w-lg py-8">
        <PrerequisiteGuide type="accounts" companyId={companyId} />
      </div>
    );
  }

  return (
    <div>
      <JournalEntryForm companyId={companyId} userId={user.id} accounts={accounts} />
    </div>
  );
}
