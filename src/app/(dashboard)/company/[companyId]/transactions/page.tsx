// src/app/(dashboard)/company/[companyId]/transactions/page.tsx
import { getTransactionsByCompanyAction } from "@/modules/accounting/actions/transaction.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon } from "lucide-react";

type Props = {
  params: Promise<{ companyId: string }>;
};

const TYPE_LABELS: Record<string, string> = {
  DIARIO: "Diario",
  APERTURA: "Apertura",
  AJUSTE: "Ajuste",
  CIERRE: "Cierre",
};

const STATUS_COLORS: Record<string, "default" | "destructive"> = {
  POSTED: "default",
  VOIDED: "destructive",
};

export default async function TransactionsPage({ params }: Props) {
  const { companyId } = await params;
  const result = await getTransactionsByCompanyAction(companyId);

  if (!result.success) redirect("/dashboard");

  const transactions = result.data;

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

      {transactions.length === 0 ? (
        <div className="text-muted-foreground py-12 text-center text-sm">
          No hay asientos registrados. Crea el primero.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Número</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Descripción</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-500">Débito</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {transactions.map((tx) => {
                const totalDebit = tx.entries
                  .filter((e) => Number(e.amount) > 0)
                  .reduce((acc, e) => acc + Number(e.amount), 0);

                return (
                  <tr key={tx.id} className="transition-colors hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono font-medium text-blue-600">{tx.number}</td>
                    <td className="px-4 py-3 text-zinc-600">
                      {new Date(tx.date).toLocaleDateString("es-VE")}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3">{tx.description}</td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-500">{TYPE_LABELS[tx.type]}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{totalDebit.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_COLORS[tx.status]}>
                        {tx.status === "POSTED" ? "Contabilizado" : "Anulado"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
