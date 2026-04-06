// src/app/(dashboard)/company/[companyId]/bank-reconciliation/[statementId]/page.tsx
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeftIcon, LandmarkIcon } from "lucide-react";
import { BankStatementService } from "@/modules/bank-reconciliation/services/BankStatementService";
import { ReconciliationWorkbench } from "@/modules/bank-reconciliation/components/ReconciliationWorkbench";

type Props = {
  params: Promise<{ companyId: string; statementId: string }>;
};

export default async function StatementDetailPage({ params }: Props) {
  const { companyId, statementId } = await params;

  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const statement = await BankStatementService.getWithTransactions(statementId, companyId);
  if (!statement) redirect(`/company/${companyId}/bank-reconciliation`);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/company/${companyId}/bank-reconciliation?accountId=${statement.bankAccountId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          Volver a extractos
        </Link>
        <div className="flex items-center gap-3">
          <LandmarkIcon className="h-6 w-6 text-zinc-400" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Conciliación de extracto</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {statement.bankAccount.name} &mdash; {statement.bankAccount.bankName} &mdash;{" "}
              {statement.bankAccount.currency}
            </p>
          </div>
        </div>
      </div>

      {/* Workbench */}
      <ReconciliationWorkbench
        statement={statement as never}
        companyId={companyId}
      />
    </div>
  );
}
