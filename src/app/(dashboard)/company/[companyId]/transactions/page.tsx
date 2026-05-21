// src/app/(dashboard)/company/[companyId]/transactions/page.tsx
import { getTransactionsByCompanyAction } from "@/modules/accounting/actions/transaction.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { TransactionList } from "@/modules/accounting/components/TransactionList";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function TransactionsPage({ params }: Props) {
  const { companyId } = await params;
  const result = await getTransactionsByCompanyAction(companyId);

  if (!result.success) redirect("/dashboard");

  const transactions = result.data;

  const contaTabs = [
    { label: "Asientos",        href: `/company/${companyId}/transactions` },
    { label: "Plan de Cuentas", href: `/company/${companyId}/accounts` },
    { label: "Reportes",        href: `/company/${companyId}/reports` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asientos Contables</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {transactions.length} asiento{transactions.length !== 1 ? "s" : ""} registrado
            {transactions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button asChild>
          <Link href={`/company/${companyId}/transactions/new`} className="gap-2">
            <PlusIcon className="h-4 w-4" />
            Nuevo Asiento
          </Link>
        </Button>
      </div>

      <ModuleTabs tabs={contaTabs} color="blue" />

      <TransactionList companyId={companyId} transactions={transactions} />
    </div>
  );
}
